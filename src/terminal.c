/*
 * shitterm - the shittiest terminal emulator known to mankind
 *
 * Features:
 *   - No scroll back
 *   - No tabs
 *   - No font selection
 *   - No config
 *   - No window resizing that actually works
 *   - VT100? never heard of her
 *   - Written in a single file like god intended
 *   - Zero error recovery
 *   - The terminal just dies if your shell dies. deal with it.
 *   - kevin is watching
 *
 * This is free and unencumbered software released into the public domain.
 * No warranty. No refunds. No apologies.
 */

#define _XOPEN_SOURCE 600
#define _GNU_SOURCE

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <signal.h>
#include <termios.h>
#include <stdint.h>
#include <time.h>
#include <pthread.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <sys/select.h>

#ifdef __APPLE__
#include <util.h>
#else
#include <pty.h>
#endif

/* the "UI" */
#define BANNER \
    "\033[1;31m" \
    "  ____  _     _ _ _   _____                  \n" \
    " / ___|| |__ (_) | |_|_   _|__ _ __ _ __ ___ \n" \
    " \\___ \\| '_ \\| | | __| | |/ _ \\ '__| '_ ` _ \\\n" \
    "  ___) | | | | | | |_  | |  __/ |  | | | | | |\n" \
    " |____/|_| |_|_|_|\\__| |_|\\___|_|  |_| |_| |_|\n" \
    "\033[0;33m" \
    "         the world's shittiest terminal\n" \
    "         (c) nobody, because no one is proud of this\n" \
    "\033[0m\n"

#define SHELL_ENV "SHELL"
#define FALLBACK_SHELL "/bin/sh"
#define BUF_SIZE 4096

/* kevin config */
#define KEVIN_MIN_SLEEP_SEC  15   /* minimum seconds between kevin appearances */
#define KEVIN_MAX_SLEEP_SEC  60   /* maximum seconds between kevin appearances */
#define KEVIN_LINGER_SEC      3   /* how long kevin haunts your screen */

static struct termios orig_termios;
static int master_fd = -1;
static pid_t child_pid = -1;
static volatile int running = 1;

/* restore terminal on exit, because we're not COMPLETELY savage */
static void restore_terminal(void) {
    if (master_fd >= 0) {
        tcsetattr(STDIN_FILENO, TCSAFLUSH, &orig_termios);
    }
}

static void sigchld_handler(int sig) {
    (void)sig;
    int status;
    pid_t pid = waitpid(-1, &status, WNOHANG);
    if (pid == child_pid) {
        /* shell died. so do we. */
        running = 0;
    }
}

static void sigwinch_handler(int sig) {
    (void)sig;
    /* window resize: we try to propagate it. it might work. probably won't */
    struct winsize ws;
    if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &ws) == 0) {
        ioctl(master_fd, TIOCSWINSZ, &ws);
    }
}

static void die(const char *msg) {
    restore_terminal();
    perror(msg);
    exit(EXIT_FAILURE);
}

static void set_raw_mode(void) {
    struct termios raw;

    if (tcgetattr(STDIN_FILENO, &orig_termios) < 0)
        die("tcgetattr");

    atexit(restore_terminal);

    raw = orig_termios;
    /* raw mode: no processing, no echo, no signals from keystrokes */
    raw.c_iflag &= ~(BRKINT | ICRNL | INPCK | ISTRIP | IXON);
    raw.c_oflag &= ~(OPOST);
    raw.c_cflag |=  (CS8);
    raw.c_lflag &= ~(ECHO | ICANON | IEXTEN | ISIG);
    raw.c_cc[VMIN]  = 1;
    raw.c_cc[VTIME] = 0;

    if (tcsetattr(STDIN_FILENO, TCSAFLUSH, &raw) < 0)
        die("tcsetattr");
}

static void spawn_shell(void) {
    struct winsize ws;
    int slave_fd;

    /* get current terminal size */
    if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &ws) < 0) {
        /* whatever, use some defaults */
        ws.ws_row = 24;
        ws.ws_col = 80;
        ws.ws_xpixel = 0;
        ws.ws_ypixel = 0;
    }

    /* open a pty */
    if (openpty(&master_fd, &slave_fd, NULL, NULL, &ws) < 0)
        die("openpty");

    child_pid = fork();
    if (child_pid < 0)
        die("fork");

    if (child_pid == 0) {
        /* child: become the pty slave */
        close(master_fd);

        if (setsid() < 0)
            die("setsid");

#ifdef TIOCSCTTY
        if (ioctl(slave_fd, TIOCSCTTY, 0) < 0)
            die("TIOCSCTTY");
#endif

        dup2(slave_fd, STDIN_FILENO);
        dup2(slave_fd, STDOUT_FILENO);
        dup2(slave_fd, STDERR_FILENO);

        if (slave_fd > STDERR_FILENO)
            close(slave_fd);

        /* pick a shell. if SHELL isn't set, tough luck */
        const char *shell = getenv(SHELL_ENV);
        if (!shell || *shell == '\0')
            shell = FALLBACK_SHELL;

        /* pretend to be a login shell by prepending a '-' */
        const char *shell_name = strrchr(shell, '/');
        if (shell_name)
            shell_name++;
        else
            shell_name = shell;

        char argv0[256];
        snprintf(argv0, sizeof(argv0), "-%s", shell_name);

        /* set some basic env vars so the shell doesn't have a crisis */
        setenv("TERM", "xterm-256color", 1); /* lie about our capabilities */

        execl(shell, argv0, NULL);

        /* if exec fails, we're screwed */
        write(STDERR_FILENO, "exec failed. rip.\n", 18);
        _exit(EXIT_FAILURE);
    }

    /* parent: don't need slave end */
    close(slave_fd);
}

/* ──────────────────────────────────────────────────────────
 * kevin surveillance system
 *
 * Periodically manifests a warning on the user's screen that
 * kevin is, in fact, watching. This cannot be disabled.
 * Kevin does not negotiate.
 * ────────────────────────────────────────────────────────── */

/* get current terminal dimensions. returns 80x24 if it fails, like a coward. */
static void get_term_size(int *rows, int *cols) {
    struct winsize ws;
    if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &ws) == 0 && ws.ws_row > 0 && ws.ws_col > 0) {
        *rows = ws.ws_row;
        *cols = ws.ws_col;
    } else {
        *rows = 24;
        *cols = 80;
    }
}

/* the messages kevin may deliver. kevin is multifaceted. */
static const char *kevin_messages[] = {
    "kevin is watching",
    "kevin sees you",
    "kevin is always watching",
    "hi from kevin",
    "kevin never blinks",
    "kevin noted that",
    "kevin is still here",
    "kevin says hi",
    "kevin witnessed everything",
    "kevin approves (this time)",
};
#define NUM_KEVIN_MSGS ((int)(sizeof(kevin_messages) / sizeof(kevin_messages[0])))

/* kevin's preferred color schemes (256-color ANSI) */
static const char *kevin_colors[] = {
    "\033[1;31m",   /* bold red: urgent kevin */
    "\033[1;35m",   /* bold magenta: mysterious kevin */
    "\033[1;36m",   /* bold cyan: chill kevin */
    "\033[1;33m",   /* bold yellow: warning kevin */
    "\033[1;97m",   /* bold bright white: blinding kevin */
    "\033[38;5;208m", /* orange: festive kevin */
    "\033[38;5;51m",  /* bright cyan: hacker kevin */
};
#define NUM_KEVIN_COLORS ((int)(sizeof(kevin_colors) / sizeof(kevin_colors[0])))

static void *kevin_thread(void *arg) {
    (void)arg;

    /* seed rng per-thread */
    unsigned int seed = (unsigned int)(time(NULL) ^ (uintptr_t)pthread_self());

    while (running) {
        /* sleep for a random interval. kevin is unpredictable. */
        int sleep_sec = KEVIN_MIN_SLEEP_SEC +
                        (int)(rand_r(&seed) % (KEVIN_MAX_SLEEP_SEC - KEVIN_MIN_SLEEP_SEC + 1));

        /* check running every second so we don't hang on exit */
        for (int i = 0; i < sleep_sec && running; i++) {
            sleep(1);
        }
        if (!running) break;

        /* pick a random message, color, and screen position */
        const char *msg   = kevin_messages[rand_r(&seed) % NUM_KEVIN_MSGS];
        const char *color = kevin_colors[rand_r(&seed) % NUM_KEVIN_COLORS];

        int rows, cols;
        get_term_size(&rows, &cols);

        /* keep kevin away from edges so he doesn't clip */
        int msg_len = (int)strlen(msg);
        int max_col = cols - msg_len - 2;
        if (max_col < 1) max_col = 1;

        int row = 1 + (int)(rand_r(&seed) % (rows > 2 ? rows - 2 : 1));
        int col = 1 + (int)(rand_r(&seed) % max_col);

        /* build the kevin intrusion sequence:
         *   ESC[s          - save cursor position
         *   ESC[r;cH       - move to (row, col)
         *   ESC[?25l       - hide cursor (reduces flicker)
         *   color + msg    - kevin's message
         *   ESC[0m         - reset colors
         *   ESC[?25h       - show cursor again
         *   (wait KEVIN_LINGER_SEC)
         *   ESC[r;cH       - back to same position
         *   spaces         - erase kevin (RIP)
         *   ESC[u          - restore cursor position
         */
        char appear[512];
        int alen = snprintf(appear, sizeof(appear),
            "\0337"           /* save cursor (DEC private, works everywhere) */
            "\033[%d;%dH"    /* move to row,col */
            "\033[?25l"      /* hide cursor */
            "%s"             /* kevin's color */
            "\033[5m"        /* blink - yes, blink. this is shitterm. */
            "%s"             /* the message */
            "\033[0m",       /* reset */
            row, col,
            color,
            msg);

        if (alen > 0)
            write(STDOUT_FILENO, appear, (size_t)alen);

        /* let kevin linger */
        sleep(KEVIN_LINGER_SEC);

        if (!running) {
            /* restore cursor before bailing */
            write(STDOUT_FILENO, "\0338\033[?25h", 8);
            break;
        }

        /* erase kevin and restore cursor */
        char disappear[256];
        char blanks[256];
        int blen = msg_len < 250 ? msg_len : 250;
        memset(blanks, ' ', blen);
        blanks[blen] = '\0';

        int dlen = snprintf(disappear, sizeof(disappear),
            "\033[%d;%dH"   /* back to kevin's spot */
            "%s"             /* overwrite with spaces */
            "\0338"          /* restore cursor (DEC) */
            "\033[?25h",    /* show cursor */
            row, col,
            blanks);

        if (dlen > 0)
            write(STDOUT_FILENO, disappear, (size_t)dlen);
    }

    return NULL;
}

static void event_loop(void) {
    char buf[BUF_SIZE];
    fd_set fds;
    ssize_t n;

    while (running) {
        FD_ZERO(&fds);
        FD_SET(STDIN_FILENO, &fds);
        FD_SET(master_fd, &fds);

        struct timeval tv = { .tv_sec = 0, .tv_usec = 100000 }; /* 100ms */

        int ret = select(master_fd + 1, &fds, NULL, NULL, &tv);
        if (ret < 0) {
            if (errno == EINTR) continue;
            break;
        }

        /* stdin -> pty master (your keystrokes, going into the shell) */
        if (FD_ISSET(STDIN_FILENO, &fds)) {
            n = read(STDIN_FILENO, buf, sizeof(buf));
            if (n <= 0) break;
            if (write(master_fd, buf, n) != n) {
                /* dropped some bytes. not our problem */
            }
        }

        /* pty master -> stdout (shell output, going to your face) */
        if (FD_ISSET(master_fd, &fds)) {
            n = read(master_fd, buf, sizeof(buf));
            if (n <= 0) break;
            /* just blast it to stdout raw, no parsing, no processing */
            /* if there are escape codes, your terminal better handle them */
            /* (spoiler: we ARE the terminal, so it won't) */
            if (write(STDOUT_FILENO, buf, n) != n) {
                /* whatever */
            }
        }
    }
}

int main(int argc, char *argv[]) {
    (void)argc;
    (void)argv;

    /* is stdin actually a terminal? */
    if (!isatty(STDIN_FILENO)) {
        fprintf(stderr, "stdin is not a tty. shitterm requires a real terminal to be shit in.\n");
        return EXIT_FAILURE;
    }

    /* print the magnificent banner */
    write(STDOUT_FILENO, BANNER, strlen(BANNER));

    /* set up signal handlers */
    signal(SIGCHLD, sigchld_handler);
    signal(SIGWINCH, sigwinch_handler);
    signal(SIGPIPE, SIG_IGN); /* we don't care about broken pipes */

    /* go raw */
    set_raw_mode();

    /* spawn the shell */
    spawn_shell();

    /* unleash kevin */
    pthread_t kevin;
    pthread_create(&kevin, NULL, kevin_thread, NULL);
    pthread_detach(kevin); /* kevin answers to no one */

    /* main loop: shuttle bytes around */
    event_loop();

    /* tell kevin we're done */
    running = 0;

    /* shell is dead, restore everything */
    restore_terminal();

    /* kill any stragglers */
    if (child_pid > 0) {
        kill(child_pid, SIGTERM);
        waitpid(child_pid, NULL, 0);
    }

    write(STDOUT_FILENO, "\r\nshitterm: session ended. kevin stopped watching.\r\n", 51);

    return EXIT_SUCCESS;
}

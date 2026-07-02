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

    /* main loop: shuttle bytes around */
    event_loop();

    /* shell is dead, restore everything */
    restore_terminal();

    /* kill any stragglers */
    if (child_pid > 0) {
        kill(child_pid, SIGTERM);
        waitpid(child_pid, NULL, 0);
    }

    write(STDOUT_FILENO, "\r\nshitterm: session ended. goodbye.\r\n", 37);

    return EXIT_SUCCESS;
}

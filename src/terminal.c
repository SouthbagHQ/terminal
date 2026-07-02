/*
 * shitterm — Southbag Terminal Emulator
 * Part of the Southbag Global Enterprise Network
 *
 * A paradigm-shifting, enterprise-grade terminal solution
 * architected for maximum synergy and minimal features.
 *
 * Southbag Philosophy:
 *   1. Kevin
 *   2. Security through obscurity
 *   3. Collect all the data
 *   4. If the user can't figure it out, it's their problem
 *
 * This software is provided without warranty.
 * Southbag is not responsible for any data loss, existential dread,
 * or encounters with Kevin.
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

#define VERSION "0.2.0"

/* ── startup banner ─────────────────────────────────────── */
/* clean, minimal, corporate */
#define BANNER \
    "\033[0m\r\n" \
    "  \033[1mshitterm\033[0m  \033[2mv" VERSION "  ·  Southbag Global Enterprise Network\033[0m\r\n" \
    "  \033[2m─────────────────────────────────────────────\033[0m\r\n" \
    "  \033[2mSecurity Status:\033[0m  \033[32m● Compliant\033[0m\r\n" \
    "  \033[2mKevin Status:   \033[0m  \033[33m● Active\033[0m\r\n" \
    "  \033[2m─────────────────────────────────────────────\033[0m\r\n\r\n"

#define SHELL_ENV    "SHELL"
#define FALLBACK_SHELL "/bin/sh"
#define BUF_SIZE     4096

/* kevin surveillance parameters */
#define KEVIN_MIN_SLEEP  20
#define KEVIN_MAX_SLEEP  90
#define KEVIN_LINGER      4   /* seconds kevin lingers */

static struct termios orig_termios;
static int  master_fd = -1;
static pid_t child_pid = -1;
static volatile int running = 1;

/* ── terminal plumbing ──────────────────────────────────── */

static void restore_terminal(void) {
    if (master_fd >= 0)
        tcsetattr(STDIN_FILENO, TCSAFLUSH, &orig_termios);
}

static void sigchld_handler(int sig) {
    (void)sig;
    int status;
    if (waitpid(-1, &status, WNOHANG) == child_pid)
        running = 0;
}

static void sigwinch_handler(int sig) {
    (void)sig;
    struct winsize ws;
    if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &ws) == 0)
        ioctl(master_fd, TIOCSWINSZ, &ws);
}

static void die(const char *msg) {
    restore_terminal();
    perror(msg);
    exit(EXIT_FAILURE);
}

static void set_raw_mode(void) {
    struct termios raw;
    if (tcgetattr(STDIN_FILENO, &orig_termios) < 0) die("tcgetattr");
    atexit(restore_terminal);
    raw = orig_termios;
    raw.c_iflag &= ~(BRKINT | ICRNL | INPCK | ISTRIP | IXON);
    raw.c_oflag &= ~(OPOST);
    raw.c_cflag |=  (CS8);
    raw.c_lflag &= ~(ECHO | ICANON | IEXTEN | ISIG);
    raw.c_cc[VMIN]  = 1;
    raw.c_cc[VTIME] = 0;
    if (tcsetattr(STDIN_FILENO, TCSAFLUSH, &raw) < 0) die("tcsetattr");
}

static void spawn_shell(void) {
    struct winsize ws;
    int slave_fd;

    if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &ws) < 0) {
        ws.ws_row = 24; ws.ws_col = 80;
        ws.ws_xpixel = 0; ws.ws_ypixel = 0;
    }
    if (openpty(&master_fd, &slave_fd, NULL, NULL, &ws) < 0) die("openpty");

    child_pid = fork();
    if (child_pid < 0) die("fork");

    if (child_pid == 0) {
        close(master_fd);
        if (setsid() < 0) die("setsid");
#ifdef TIOCSCTTY
        if (ioctl(slave_fd, TIOCSCTTY, 0) < 0) die("TIOCSCTTY");
#endif
        dup2(slave_fd, STDIN_FILENO);
        dup2(slave_fd, STDOUT_FILENO);
        dup2(slave_fd, STDERR_FILENO);
        if (slave_fd > STDERR_FILENO) close(slave_fd);

        const char *shell = getenv(SHELL_ENV);
        if (!shell || !*shell) shell = FALLBACK_SHELL;
        const char *name = strrchr(shell, '/');
        name = name ? name + 1 : shell;
        char argv0[256];
        snprintf(argv0, sizeof(argv0), "-%s", name);
        setenv("TERM", "xterm-256color", 1);
        execl(shell, argv0, NULL);
        write(STDERR_FILENO, "exec failed\n", 12);
        _exit(EXIT_FAILURE);
    }
    close(slave_fd);
}

/* ── kevin surveillance subsystem ──────────────────────────
 *
 * Kevin is a core Southbag security primitive. Kevin observes
 * all terminal activity and surfaces periodic compliance
 * notifications. Kevin cannot be disabled. Kevin is always
 * watching. This is intentional and a feature.
 *
 * Notification design: a clean bordered card rendered
 * in the bottom-right corner of the viewport, consistent
 * with the Southbag enterprise UX specification.
 * ────────────────────────────────────────────────────────── */

static void get_term_size(int *rows, int *cols) {
    struct winsize ws;
    if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &ws) == 0 &&
        ws.ws_row > 0 && ws.ws_col > 0) {
        *rows = ws.ws_row;
        *cols = ws.ws_col;
    } else {
        *rows = 24; *cols = 80;
    }
}

/* Kevin's compliance messages — authoritative, terse, enterprise-grade */
static const char *kevin_notices[] = {
    "kevin is watching",
    "activity logged",
    "session recorded",
    "compliance check passed",
    "kevin sees you",
    "data collected",
    "audit trail updated",
    "kevin acknowledges",
    "behavioral analysis: nominal",
    "surveillance active",
};
#define NUM_NOTICES ((int)(sizeof(kevin_notices) / sizeof(kevin_notices[0])))

/*
 * Renders a notification card at a fixed bottom-right position.
 *
 * Looks like:
 *
 *   ┌─────────────────────────────┐
 *   │ ● Kevin  kevin is watching  │
 *   └─────────────────────────────┘
 *
 * Uses DEC save/restore so we don't destroy the user's cursor.
 */
static void kevin_show(int rows, int cols, const char *msg) {
    /* card dimensions */
    /* "│ ● Kevin  <msg>  │" */
    int prefix_len = 10; /* " ● Kevin  " */
    int suffix_len = 2;  /* "  " padding + border char */
    int inner      = prefix_len + (int)strlen(msg) + suffix_len;
    /* top/bottom border: ┌──...──┐ */
    /* card position: bottom-right, 2 rows from bottom, right-aligned */
    int card_col = cols - inner - 1;
    if (card_col < 1) card_col = 1;
    int row_top    = rows - 3;
    int row_middle = rows - 2;
    int row_bottom = rows - 1;
    if (row_top < 1) row_top = 1;

    /* build the three card lines */
    char top[256], mid[512], bot[256];
    int i;

    /* top border */
    int tlen = 0;
    tlen += snprintf(top + tlen, sizeof(top) - tlen,
        "\033[%d;%dH"           /* move to top row */
        "\033[0m"               /* reset */
        "\033[2m"               /* dim */
        "┌",
        row_top, card_col);
    for (i = 0; i < inner; i++)
        tlen += snprintf(top + tlen, sizeof(top) - tlen, "─");
    tlen += snprintf(top + tlen, sizeof(top) - tlen, "┐\033[0m");

    /* middle line: │ ● Kevin  <msg>  │ */
    snprintf(mid, sizeof(mid),
        "\033[%d;%dH"           /* move to middle row */
        "\033[2m│\033[0m"       /* dim border */
        " \033[1;33m●\033[0m"   /* amber dot */
        " \033[1mKevin\033[0m"  /* bold Kevin */
        "  "
        "\033[0;2m%s\033[0m"   /* dim message */
        "  "
        "\033[2m│\033[0m",      /* dim border */
        row_middle, card_col,
        msg);

    /* bottom border */
    int blen = 0;
    blen += snprintf(bot + blen, sizeof(bot) - blen,
        "\033[%d;%dH\033[2m└",
        row_bottom, card_col);
    for (i = 0; i < inner; i++)
        blen += snprintf(bot + blen, sizeof(bot) - blen, "─");
    blen += snprintf(bot + blen, sizeof(bot) - blen, "┘\033[0m");

    /* save cursor, draw card, wait, erase card, restore cursor */
    char seq[2048];
    int  slen = 0;

    /* save cursor */
    slen += snprintf(seq + slen, sizeof(seq) - slen, "\0337\033[?25l");

    /* draw */
    slen += snprintf(seq + slen, sizeof(seq) - slen, "%s%s%s", top, mid, bot);

    write(STDOUT_FILENO, seq, (size_t)slen);
}

static void kevin_erase(int rows, int cols, const char *msg) {
    int prefix_len = 10;
    int suffix_len = 2;
    int inner      = prefix_len + (int)strlen(msg) + suffix_len;
    int card_col   = cols - inner - 1;
    if (card_col < 1) card_col = 1;
    int row_top    = rows - 3;
    int row_middle = rows - 2;
    int row_bottom = rows - 1;
    if (row_top < 1) row_top = 1;

    char blank[256];
    int  blen = inner + 2; /* border chars */
    if (blen > (int)sizeof(blank) - 1) blen = (int)sizeof(blank) - 1;
    memset(blank, ' ', blen);
    blank[blen] = '\0';

    char seq[1024];
    int  slen = 0;
    slen += snprintf(seq + slen, sizeof(seq) - slen,
        "\033[%d;%dH%s"
        "\033[%d;%dH%s"
        "\033[%d;%dH%s"
        "\0338\033[?25h",
        row_top,    card_col, blank,
        row_middle, card_col, blank,
        row_bottom, card_col, blank);
    write(STDOUT_FILENO, seq, (size_t)slen);
}

static void *kevin_thread(void *arg) {
    (void)arg;
    unsigned int seed = (unsigned int)(time(NULL) ^ (uintptr_t)pthread_self());

    while (running) {
        /* wait a random interval */
        int wait = KEVIN_MIN_SLEEP +
                   (int)(rand_r(&seed) % (KEVIN_MAX_SLEEP - KEVIN_MIN_SLEEP + 1));
        for (int i = 0; i < wait && running; i++) sleep(1);
        if (!running) break;

        const char *msg = kevin_notices[rand_r(&seed) % NUM_NOTICES];
        int rows, cols;
        get_term_size(&rows, &cols);

        kevin_show(rows, cols, msg);

        for (int i = 0; i < KEVIN_LINGER && running; i++) sleep(1);

        kevin_erase(rows, cols, msg);
    }

    /* restore cursor on exit */
    write(STDOUT_FILENO, "\0338\033[?25h", 8);
    return NULL;
}

/* ── main event loop ────────────────────────────────────── */

static void event_loop(void) {
    char buf[BUF_SIZE];
    fd_set fds;
    ssize_t n;

    while (running) {
        FD_ZERO(&fds);
        FD_SET(STDIN_FILENO, &fds);
        FD_SET(master_fd, &fds);

        struct timeval tv = { .tv_sec = 0, .tv_usec = 100000 };
        int ret = select(master_fd + 1, &fds, NULL, NULL, &tv);
        if (ret < 0) {
            if (errno == EINTR) continue;
            break;
        }

        if (FD_ISSET(STDIN_FILENO, &fds)) {
            n = read(STDIN_FILENO, buf, sizeof(buf));
            if (n <= 0) break;
            (void)write(master_fd, buf, n);
        }

        if (FD_ISSET(master_fd, &fds)) {
            n = read(master_fd, buf, sizeof(buf));
            if (n <= 0) break;
            (void)write(STDOUT_FILENO, buf, n);
        }
    }
}

/* ── entry point ────────────────────────────────────────── */

int main(int argc, char *argv[]) {
    (void)argc; (void)argv;

    if (!isatty(STDIN_FILENO)) {
        fprintf(stderr, "shitterm: stdin is not a tty\n");
        return EXIT_FAILURE;
    }

    write(STDOUT_FILENO, BANNER, strlen(BANNER));

    signal(SIGCHLD, sigchld_handler);
    signal(SIGWINCH, sigwinch_handler);
    signal(SIGPIPE, SIG_IGN);

    set_raw_mode();
    spawn_shell();

    pthread_t kevin;
    pthread_create(&kevin, NULL, kevin_thread, NULL);
    pthread_detach(kevin);

    event_loop();

    running = 0;
    restore_terminal();

    if (child_pid > 0) {
        kill(child_pid, SIGTERM);
        waitpid(child_pid, NULL, 0);
    }

    write(STDOUT_FILENO,
        "\r\n\033[2mshitterm: session ended  ·  kevin has stopped watching\033[0m\r\n",
        62);

    return EXIT_SUCCESS;
}

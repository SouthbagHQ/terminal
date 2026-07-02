# shitterm

> A paradigm-shifting, enterprise-grade terminal emulator from the [Southbag Global Enterprise Network](https://southbag.cc).

[![Build](https://github.com/SouthbagHQ/terminal/actions/workflows/build.yml/badge.svg)](https://github.com/SouthbagHQ/terminal/actions/workflows/build.yml)

---

## Overview

**shitterm** is Southbag's official terminal emulator. It is fast, minimal, and compliant with Southbag's core security philosophy. All sessions are monitored by Kevin.

### Architecture

shitterm operates by opening a pseudo-terminal, forking your shell into it, and bidirectionally shuttling bytes between the PTY master and stdout via a `select(2)` loop. There is no VT100 parsing, no scrollback buffer, no configuration file, and no font selection. These are not bugs. These are the result of careful architectural decisions made at the highest levels of the Southbag engineering organization.

### Kevin

Kevin is a first-class security primitive embedded directly in the terminal process. Kevin operates as a background surveillance thread, periodically surfacing compliance notifications in the lower-right corner of the viewport. Kevin's notification cadence is randomized to prevent prediction and circumvention. Kevin cannot be disabled. Kevin is always watching.

> _"Kevin."_ — Southbag Philosophy, §1

---

## Installation

### Pre-built Binaries

Download from [Releases](https://github.com/SouthbagHQ/terminal/releases).

```sh
chmod +x shitterm-linux-x86_64
./shitterm-linux-x86_64
```

### Build from Source

**Dependencies:** a C99 compiler, POSIX system, `openpty(3)`.

```sh
git clone https://github.com/SouthbagHQ/terminal
cd terminal
make
./shitterm
```

#### Cross-compile

```sh
# Linux aarch64
make CC=aarch64-linux-gnu-gcc LDFLAGS="-lutil -lpthread"

# macOS (clang)
make CC=clang LDFLAGS=-lpthread
```

---

## Platform Support

| Platform | Architecture | Status |
|----------|-------------|--------|
| Linux | x86_64 | ✅ |
| Linux | aarch64 | ✅ |
| Linux | armv7 | ✅ |
| macOS | x86_64 (Intel) | ✅ |
| macOS | arm64 (Apple Silicon) | ✅ |
| FreeBSD | x86_64 | ✅ |
| OpenBSD | x86_64 | ✅ |
| NetBSD | x86_64 | ✅ |
| Windows | any | ❌ |

---

## Known Limitations

- No scrollback
- No tabs
- No font configuration
- No window resize guarantee
- Kevin

---

## License

Released into the public domain. No warranty is provided. Southbag is not liable for data loss, productivity loss, or unexpected Kevin encounters.

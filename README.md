# shitterm

> The world's shittiest terminal emulator.

[![Build](https://github.com/SouthbagHQ/terminal/actions/workflows/build.yml/badge.svg)](https://github.com/SouthbagHQ/terminal/actions/workflows/build.yml)

## What is this?

It's a terminal emulator. Barely. It:

- Opens a PTY
- Forks your shell into it
- Copies bytes back and forth

That's it. No:
- Scroll back
- Tabs
- Font selection
- Config files
- Window resizing (well, it tries, but no promises)
- VT100 parsing (we pass escape codes through and hope your underlying terminal handles them, which it won't because we ARE the terminal)

## Building

```sh
make
```

### Dependencies

- A C compiler
- A POSIX-ish system (Linux, macOS, FreeBSD, OpenBSD, NetBSD)
- `openpty(3)` / `-lutil`

### Cross-compile

```sh
make CC=aarch64-linux-gnu-gcc LDFLAGS=-lutil
```

## Usage

```sh
./shitterm
```

Your shell will start. Things may or may not work. Good luck.

## Supported Platforms

| OS | Arch |
|----|------|
| Linux | x86_64, aarch64, armv7 |
| macOS | x86_64, arm64 |
| FreeBSD | x86_64 |
| OpenBSD | x86_64 |
| NetBSD | x86_64 |
| Windows | lol no |

## Pre-built Binaries

Check the [Releases](https://github.com/SouthbagHQ/terminal/releases) page.

## License

Public domain. No warranty. No refunds. No apologies.

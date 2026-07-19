# Southbag Terminal

> The official terminal emulator of the [Southbag Global Enterprise Network](https://southbag.cc).

[![Build](https://github.com/SouthbagHQ/terminal/actions/workflows/build.yml/badge.svg)](https://github.com/SouthbagHQ/terminal/actions/workflows/build.yml)

---

## Overview

Southbag Terminal is a cross-platform terminal emulator built on Electron and xterm.js. It wraps a real PTY (via `node-pty`), so scrollback, resizing, and full VT100/256-color support work the way you'd expect from a modern terminal.

### Kevin

Kevin is a compliance-monitoring feature embedded directly in the application. Kevin periodically surfaces status notifications in the lower-right corner of the window, on a randomized cadence. Kevin cannot be disabled.

---

## Installation

Download a build for your platform from [Releases](https://github.com/SouthbagHQ/terminal/releases).

## Development

**Requirements:** [Bun](https://bun.sh), a C/C++ toolchain (for building `node-pty`'s native module).

```sh
git clone https://github.com/SouthbagHQ/terminal
cd terminal
bun install
bun run rebuild   # rebuild node-pty against Electron's Node ABI
bun run start
```

## Building

```sh
bun run dist
```

Produces installers/packages under `dist/` via `electron-builder` (AppImage + deb on Linux, dmg on macOS, nsis on Windows).

---

## Platform Support

| Platform | Status |
|----------|--------|
| Linux    | ✅ |
| macOS    | ✅ |
| Windows  | ✅ |

---

## License

Released into the public domain (Unlicense). No warranty is provided.

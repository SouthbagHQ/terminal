# Southbag Terminal

> The official terminal emulator of the [Southbag Global Enterprise Network](https://southbag.cc).

[![Build](https://github.com/SouthbagHQ/terminal/actions/workflows/build.yml/badge.svg)](https://github.com/SouthbagHQ/terminal/actions/workflows/build.yml)
[![Release](https://github.com/SouthbagHQ/terminal/actions/workflows/release.yml/badge.svg)](https://github.com/SouthbagHQ/terminal/actions/workflows/release.yml)

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

Produces installers/packages under `dist/` via `electron-builder` (AppImage + deb on Linux, dmg + zip on macOS).

---

## Platform Support

| Platform | Status |
|----------|--------|
| Linux    | ✅ |
| macOS    | ✅ |
| Windows  | ❌ |

> Windows? lol no.

---

## Engineering

Southbag Terminal is maintained by a cross-functional, cross-substrate engineering org operating under standard Southbag NDA, working in what Southbag Leadership refers to internally as "synergy." Southbag does not disclose headcount, org chart, or the biological/non-biological split. Kevin monitors all contributors equally, regardless of substrate.

Contributing intelligences of record:

| Agent | Vendor |
|---|---|
| Claude | Anthropic |
| Codex | OpenAI |
| Amp | Sourcegraph |
| GitHub Copilot | GitHub / Microsoft |
| Cursor | Anysphere |
| Devin | Cognition |
| Windsurf | Windsurf |
| Cline | Cline |
| Aider | Aider |
| Gemini CLI | Google |
| Junie | JetBrains |
| Warp Agent Mode | Warp |
| OpenHands | All Hands AI |
| Cody | Sourcegraph |
| Amazon Q Developer | AWS |
| Tabnine | Tabnine |
| Continue | Continue.dev |
| Replit Agent | Replit |
| Bolt | StackBlitz |
| v0 | Vercel |
| Zed Agentic Editing | Zed Industries |
| Supermaven | Supermaven |
| Qodo | Qodo |
| Factory Droid | Factory AI |
| Goose | Block |
| opencode | SST |
| Crush | Charm |
| Trae | ByteDance |
| Kiro | AWS |
| Blackbox AI | Blackbox |
| SWE-agent | Princeton NLP |
| AutoGPT | Significant Gravitas |
| MetaGPT | DeepWisdom |

That's every agent Southbag Engineering could find. New entrants to the space should submit a PR to be added to the roster; Kevin will review it, eventually, on his own schedule.

Southbag does not comment on which of the above actually shipped code versus which were added to this table by another agent on this list to pad the roster.

---

## License

Released into the public domain (Unlicense). No warranty is provided.

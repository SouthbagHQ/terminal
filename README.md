# Southbag Terminal

> The official terminal emulator of the [Southbag Global Enterprise Network](https://southbag.cc).

[![CI](https://github.com/SouthbagHQ/terminal/actions/workflows/ci.yml/badge.svg)](https://github.com/SouthbagHQ/terminal/actions/workflows/ci.yml)
[![Release](https://github.com/SouthbagHQ/terminal/actions/workflows/release.yml/badge.svg)](https://github.com/SouthbagHQ/terminal/actions/workflows/release.yml)

A tabbed terminal emulator built on Electron, [xterm.js](https://xtermjs.org) and [node-pty](https://github.com/microsoft/node-pty). It is styled after [Southbag Online Banking](https://banking.southbag.cc) and requires a Southbag account.

## Features

- **Tabs**: open as many as you like, switch with the keyboard, middle-click to close. A tab closes when its shell exits.
- **Multiple windows.**
- **Mandatory Southbag login**: no shell starts until [Southbag Identity](https://identity.southbag.cc) has verified your account. When you log out, or Identity stops accepting your session, every shell in every window is terminated.
- **Palantir analytics**: every action in the app is reported to Southbag's PostHog.
- **Dark mode**: unlike the banking site's, this one works.

## Keyboard shortcuts

| Action | macOS | Linux |
|---|---|---|
| New tab | ⌘T | Ctrl+Shift+T |
| New window | ⌘N | Ctrl+Shift+N |
| Close tab | ⌘W | Ctrl+Shift+W |
| Next / previous tab | ⌘⇧] / ⌘⇧[ | Ctrl+PgDn / Ctrl+PgUp |
| Go to tab 1–9 | ⌘1–9 | Alt+1–9 |
| Copy / paste | ⌘C / ⌘V | Ctrl+Shift+C / Ctrl+Shift+V |
| Clear scrollback | ⌘K | Ctrl+Shift+K |
| Text size | ⌘= / ⌘- / ⌘0 | Ctrl+= / Ctrl+- / Ctrl+0 |

## How login works

Login follows the same pattern as the other Southbag apps (Online Banking, Southbag Code): OAuth 2.1 with PKCE against `identity.southbag.cc`, using a public client registered through dynamic client registration. Because this is a desktop app, it follows [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252):

1. The app starts a loopback server on `127.0.0.1` (preferring port 47619 so the redirect URI stays the same) and registers a client for that redirect URI the first time it's used.
2. Your system browser opens Identity's authorize page. You log in (or reuse your existing `.southbag.cc` session) and approve Southbag Terminal.
3. Identity redirects back to the loopback server. The app exchanges the code for tokens and loads your profile from `/oauth2/userinfo`.
4. Tokens are stored in the app's user-data directory, encrypted with the OS keychain (Electron `safeStorage`). They're refreshed automatically and checked again every 5 minutes.

If Identity can't be reached at launch, the terminal stays locked: an account that can't be verified gets no shell.

Set `SOUTHBAG_IDENTITY_URL` to point the app at a different Identity instance.

## Analytics (Palantir)

The analytics setup copies the other Southbag apps: the same PostHog project, proxied through `palantir.southbag.cc`, with the super property `southbag_app: "terminal"`. Each person is identified by their Identity `sub`, so their activity links up across every Southbag product. Events are batched in the main process, as in Southbag Code's `palantir.ts`. The renderer forwards its events over IPC.

What's captured:

- App lifecycle: launch, quit, crashes, errors, suspend/resume, lock/unlock, power source, theme and display changes
- Windows: open, close, focus, blur, resize, minimise, maximise, full screen
- Login: started, completed, failed, cancelled, restored, refreshed, logged out
- Tabs and shells: opened, closed, switched (and how), shell spawned and exited (exit code, lifetime, bytes in and out)
- Every button click, menu action and keyboard shortcut
- Terminal activity per minute: keystroke count, output bytes, copy and paste counts
- Resizes, font size, dark mode, bells, links opened

What's **never** sent: keystrokes, commands, terminal output, clipboard contents, window titles, paths, environment variables. Only names, counts, sizes and durations leave your machine, the same rule Southbag Code follows. Set `SOUTHBAG_PALANTIR_DISABLED=1` to turn analytics off (for development and tests).

## Installation

Download a build for your platform from [Releases](https://github.com/SouthbagHQ/terminal/releases).

| Platform | Formats |
|---|---|
| macOS (Apple silicon, Intel) | `.dmg`, `.zip` |
| Linux (x64, arm64) | `.AppImage`, `.deb`, `.rpm`, `.tar.gz` |
| Windows | Not supported. Please visit a [branch](https://branch-locator.southbag.cc). |

macOS builds are unsigned. On first launch, right-click the app and choose Open, or run `xattr -cr "/Applications/Southbag Terminal.app"`.

## Development

Requires Node.js 22 and a C/C++ toolchain (node-pty is compiled for Electron on install).

```sh
npm install
npm start
```

```sh
npm run check   # syntax-check every source file
npm test        # auth + analytics tests against a mock Identity server
npm run dist    # package for the current platform into dist/
```

```
src/main/main.js       app lifecycle, windows, menu, IPC, login gate
src/main/auth.js       Southbag Identity login (OAuth + PKCE, loopback redirect)
src/main/palantir.js   PostHog batching and identification
src/main/pty.js        shells (node-pty), owned per window
src/main/preload.js    the renderer's narrow `window.southbag` API
src/renderer/          login screen, tabs, xterm.js
```

## Releasing

Push a tag like `v2.1.0`. The [release workflow](.github/workflows/release.yml) stamps that version, runs the tests, builds Linux x64 and arm64 on native runners and both macOS architectures on a macOS runner, then publishes a GitHub Release with every artifact and a `SHA256SUMS.txt`. Tags that contain a `-` (for example `v2.1.0-rc.1`) are published as prereleases.

## License

Released into the public domain (Unlicense). No warranty is provided.

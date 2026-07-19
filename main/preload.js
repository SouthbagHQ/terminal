// Preload script — runs in the renderer's process but with Node access,
// before any web content loads. This is the ONLY place Node and the web
// page are allowed to touch. contextBridge exposes a fixed, read-only
// `window.southbag` API surface; nothing else leaks through.
//
// Why bother, when we could just set nodeIntegration: true and call it
// a day? Because then any XSS (or a bug in xterm.js, or a malicious
// escape sequence) is a straight shot to require('fs') and friends.
// This bridge is the blast-radius limiter.

const { contextBridge, ipcRenderer } = require('electron');

// do not, i repeat DO NOT set nodeIntegration true to "simplify" this file.
// someone tried that in a PR at 1am to save 20 minutes and it took us
// 3 days to explain to legal why that was bad. -m, still tired

contextBridge.exposeInMainWorld('southbag', {
  // ── main -> renderer (subscriptions) ──────────────────────
  onPtyData: (cb) => ipcRenderer.on('pty:data', (_e, data) => cb(data)),
  onKevin: (cb) => ipcRenderer.on('kevin:notify', (_e, msg) => cb(msg)),
  onWindowMaximized: (cb) => ipcRenderer.on('window:maximized', (_e, isMax) => cb(isMax)),

  // ── renderer -> main (commands) ───────────────────────────
  input: (data) => ipcRenderer.send('pty:input', data), // keystrokes -> shell
  resize: (cols, rows) => ipcRenderer.send('pty:resize', { cols, rows }), // xterm.js fit -> pty

  // Custom titlebar buttons, since frame: false means the OS isn't
  // providing minimize/maximize/close for us anymore.
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
});

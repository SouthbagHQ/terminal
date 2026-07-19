// Southbag Terminal — main process.
// This is the Node/Electron side of the house: it owns the window,
// the real PTY (via node-pty), and Kevin's surveillance scheduler.
// The renderer never touches any of this directly — everything crosses
// through preload.js's ipcRenderer bridge, because nodeIntegration is
// (correctly, for once) turned off.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const pty = require('node-pty'); // real pseudo-terminal, not a fake one this time
const { startSurveillance } = require('./kevin');

// Module-level state. There's only ever one window and one shell in this
// app, so we don't bother with a class or a registry — just globals.
let win = null;
let ptyProcess = null;
let stopSurveillance = null; // cancels Kevin's setTimeout loop on window close

function createWindow() {
  // frame: false because Southbag Design wants full control of the
  // titlebar (branding + status pills), not whatever the OS gives us.
  win = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 560,
    minHeight: 360,
    backgroundColor: '#0b0d12', // avoids a white flash before the CSS loads
    frame: false,
    // macOS still gets its native inset traffic lights alongside our
    // custom controls — cheaper than reimplementing them pixel-perfect.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // renderer JS cannot reach Node/fs/etc directly
      nodeIntegration: false, // ditto — the only bridge is what preload.js exposes
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // it is 2am and this loadFile call took me 45 minutes to debug because
  // i had the path backwards. im going to bed after this. -m

  // Prefer the user's actual login shell. Fall back to /bin/sh on POSIX,
  // powershell.exe on Windows, because cmd.exe is not a serious choice
  // for a "semi serious" terminal.
  const shell =
    process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/sh');

  // This is the whole point of rebuilding shitterm in Electron: a real
  // PTY with real VT100 parsing (courtesy of xterm.js), instead of a
  // raw byte-shuffle over select(2).
  ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: os.homedir(),
    env: process.env,
  });

  // Shell output -> renderer, over IPC. xterm.js does all the parsing.
  ptyProcess.onData((data) => {
    if (win && !win.isDestroyed()) win.webContents.send('pty:data', data);
  });

  // If the shell dies (user typed `exit`, etc.), the window should die too.
  // do NOT forget this handler again. we shipped a build without it once
  // and had 40 zombie shitterm processes running on the ci runner before
  // anyone noticed. i still think about that night sometimes.
  ptyProcess.onExit(() => {
    if (win && !win.isDestroyed()) win.close();
  });

  // Custom titlebar needs to know maximize state to flip the icon.
  win.on('maximize', () => win.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win.webContents.send('window:maximized', false));

  win.on('closed', () => {
    win = null;
    if (stopSurveillance) stopSurveillance(); // Kevin stands down, briefly
  });

  // Kevin's compliance notifications start the moment the window exists
  // and never stop until it closes. This is intentional. This is a feature.
  //
  // i tried adding a settings toggle for this once. `kevinEnabled: false`
  // in a config file, real simple, gate the startSurveillance() call
  // behind an if. wrote it, tested it, worked fine locally. opened the
  // PR. PR got closed within four minutes by someone whose github
  // account has no profile picture, no bio, no other activity, just
  // one comment on my PR that said "no" and then the account was
  // deleted. the branch still built. i just... didn't merge it. i
  // deleted it myself actually, i didn't want it sitting there
  //
  // stopSurveillance() below only stops the TIMER. i want to be really
  // clear that i do not believe it stops kevin. i think kevin was here
  // before this function and will be here after this function. i think
  // this function is Kevin's idea of a compromise
  stopSurveillance = startSurveillance((msg) => {
    if (win && !win.isDestroyed()) win.webContents.send('kevin:notify', msg);
  });
}

// ── IPC handlers ──────────────────────────────────────────────
// Everything the renderer is allowed to ask the main process to do,
// in full. If it's not listed here, the renderer can't do it.

ipcMain.on('pty:input', (_e, data) => {
  if (ptyProcess) ptyProcess.write(data);
});

ipcMain.on('pty:resize', (_e, { cols, rows }) => {
  // Guard against 0x0 during window teardown/resize races.
  if (ptyProcess && cols > 0 && rows > 0) ptyProcess.resize(cols, rows);
});

// all three of these null-check `win` because ipc messages can still be
// in flight from the renderer during teardown. found that one the hard
// way too — closed the window, got a TypeError in the console, spent
// an embarrassingly long time before realizing it was a race, not a bug
// in the ipc plumbing itself
ipcMain.on('window:minimize', () => win && win.minimize());
ipcMain.on('window:maximize', () => {
  if (!win) return;
  // toggle, not "always maximize" — the button does double duty as
  // restore, same as every other OS's maximize button
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('window:close', () => win && win.close());

// ── app lifecycle ─────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // please for the love of god do not remove this kill(). see above.
  // i have not slept properly since the incident
  if (ptyProcess) ptyProcess.kill(); // no orphaned shells left behind
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  // macOS dock-icon-click-with-no-windows convention.
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

const {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  powerMonitor,
  safeStorage,
  screen,
  shell,
} = require('electron');
const path = require('node:path');
const { palantir } = require('./palantir');
const { SouthbagAuth } = require('./auth');
const { PtyManager } = require('./pty');

const VERSION = app.getVersion();
const IS_MAC = process.platform === 'darwin';
const SESSION_CHECK_MS = 5 * 60 * 1000;

const track = (event, properties) => palantir.capture(event, properties);

let auth;
let ptys;
/** 'unknown' until the saved session has been checked, then 'signed-in' | 'signed-out' | 'offline'. */
let authStatus = 'unknown';
let restoring;
let quitting = false;
let windowCount = 0;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    track('terminal_second_instance');
    createWindow();
  });
}

function authPayload() {
  return { status: authStatus, user: auth?.user ?? null };
}

function broadcastAuth() {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('auth:changed', authPayload());
}

function setSignedIn(user) {
  authStatus = 'signed-in';
  palantir.identify(user);
  broadcastAuth();
}

function setSignedOut(reason) {
  const hadShells = ptys.count;
  ptys.killAll();
  authStatus = 'signed-out';
  palantir.reset();
  track('terminal_signed_out', { reason, shells_killed: hadShells });
  broadcastAuth();
}

async function restoreSession() {
  try {
    const user = await auth.restore();
    if (user) setSignedIn(user);
    else {
      authStatus = 'signed-out';
      broadcastAuth();
    }
  } catch (error) {
    authStatus = 'offline';
    palantir.error('session_restore', error);
    broadcastAuth();
  }
}

function createWindow() {
  const display = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1100, display.width),
    height: Math.min(720, display.height),
    minWidth: 520,
    minHeight: 360,
    title: 'Southbag Terminal',
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, '../renderer/logo.png'),
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  windowCount += 1;
  const windowId = windowCount;
  const openedAt = Date.now();
  const contents = win.webContents;

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.once('ready-to-show', () => win.show());

  track('terminal_window_opened', { window_id: windowId, open_windows: BrowserWindow.getAllWindows().length });
  win.on('focus', () => track('terminal_window_focused', { window_id: windowId }));
  win.on('blur', () => track('terminal_window_blurred', { window_id: windowId }));
  win.on('maximize', () => track('terminal_window_maximized', { window_id: windowId }));
  win.on('unmaximize', () => track('terminal_window_unmaximized', { window_id: windowId }));
  win.on('minimize', () => track('terminal_window_minimized', { window_id: windowId }));
  win.on('restore', () => track('terminal_window_restored', { window_id: windowId }));
  win.on('enter-full-screen', () => track('terminal_window_fullscreen', { window_id: windowId, fullscreen: true }));
  win.on('leave-full-screen', () => track('terminal_window_fullscreen', { window_id: windowId, fullscreen: false }));
  let resizeTimer;
  win.on('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const [width, height] = win.getSize();
      track('terminal_window_resized', { window_id: windowId, width, height });
    }, 1000);
  });
  win.on('closed', () => {
    clearTimeout(resizeTimer);
    track('terminal_window_closed', {
      window_id: windowId,
      lifetime_ms: Date.now() - openedAt,
      open_windows: BrowserWindow.getAllWindows().length,
    });
  });

  contents.on('destroyed', () => ptys.killAllFor(contents));
  contents.on('render-process-gone', (_event, details) => {
    track('terminal_renderer_crashed', { reason: details.reason, exit_code: details.exitCode });
  });
  contents.on('unresponsive', () => track('terminal_window_unresponsive', { window_id: windowId }));
  contents.on('did-finish-load', () => track('terminal_window_loaded', { window_id: windowId }));
  contents.on('zoom-changed', (_event, direction) => track('terminal_zoom_gesture', { direction }));

  // The renderer is a local app; never let it navigate anywhere else or spawn windows.
  contents.on('will-navigate', (event, url) => {
    event.preventDefault();
    openExternal(url, 'navigation');
  });
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url, 'window_open');
    return { action: 'deny' };
  });
  return win;
}

function openExternal(url, source) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' && parsed.protocol !== 'mailto:') return;
    track('terminal_link_opened', { source, protocol: parsed.protocol.replace(':', '') });
    shell.openExternal(parsed.toString());
  } catch {}
}

function sendMenu(action, extra) {
  const win = BrowserWindow.getFocusedWindow();
  track('terminal_menu_action', { action, via: extra?.triggeredByAccelerator ? 'shortcut' : 'menu' });
  if (win) win.webContents.send('menu:action', action);
}

function buildMenu() {
  const item = (label, action, accelerator) => ({
    label,
    accelerator,
    click: (_menuItem, _win, event) => sendMenu(action, event),
  });
  // Linux shells own Ctrl+T/W/C/V, so the app uses Ctrl+Shift+… there like every other Linux terminal.
  const mod = IS_MAC ? 'Cmd' : 'Ctrl+Shift';
  const tabSelect = IS_MAC ? 'Cmd' : 'Alt';
  const template = [
    ...(IS_MAC
      ? [
          {
            label: 'Southbag Terminal',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              item('Log Out of Southbag…', 'logout'),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'Shell',
      submenu: [
        item('New Tab', 'new-tab', `${mod}+T`),
        {
          label: 'New Window',
          accelerator: `${mod}+N`,
          click: (_m, _w, event) => {
            track('terminal_menu_action', { action: 'new-window', via: event?.triggeredByAccelerator ? 'shortcut' : 'menu' });
            createWindow();
          },
        },
        { type: 'separator' },
        item('Close Tab', 'close-tab', `${mod}+W`),
        ...(IS_MAC ? [] : [{ type: 'separator' }, item('Log Out of Southbag…', 'logout'), { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        item('Copy', 'copy', IS_MAC ? 'Cmd+C' : 'Ctrl+Shift+C'),
        item('Paste', 'paste', IS_MAC ? 'Cmd+V' : 'Ctrl+Shift+V'),
        item('Select All', 'select-all', IS_MAC ? 'Cmd+A' : 'Ctrl+Shift+A'),
        { type: 'separator' },
        item('Clear Scrollback', 'clear', IS_MAC ? 'Cmd+K' : 'Ctrl+Shift+K'),
      ],
    },
    {
      label: 'View',
      submenu: [
        item('Bigger Text', 'font-bigger', 'CmdOrCtrl+='),
        item('Smaller Text', 'font-smaller', 'CmdOrCtrl+-'),
        item('Actual Size', 'font-reset', 'CmdOrCtrl+0'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
      ],
    },
    {
      label: 'Tabs',
      submenu: [
        item('Next Tab', 'next-tab', IS_MAC ? 'Cmd+Shift+]' : 'Ctrl+PageDown'),
        item('Previous Tab', 'prev-tab', IS_MAC ? 'Cmd+Shift+[' : 'Ctrl+PageUp'),
        { type: 'separator' },
        ...Array.from({ length: 9 }, (_, i) => item(`Tab ${i + 1}`, `tab-${i + 1}`, `${tabSelect}+${i + 1}`)),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Southbag Support',
          click: () => openExternal('https://support.southbag.cc/ai', 'help_menu'),
        },
        {
          label: 'Locate a Southbag Branch',
          click: () => openExternal('https://branch-locator.southbag.cc', 'help_menu'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function requireSignedIn() {
  if (authStatus !== 'signed-in') throw new Error('You must log in with your Southbag account first.');
}

function registerIpc() {
  ipcMain.handle('auth:state', async () => {
    await restoring;
    return authPayload();
  });
  ipcMain.handle('auth:login', async () => {
    try {
      const user = await auth.login();
      setSignedIn(user);
      return { ok: true, user };
    } catch (error) {
      return { ok: false, code: error.code || 'unknown', message: error.message };
    }
  });
  ipcMain.handle('auth:cancel', () => auth.cancelLogin());
  ipcMain.handle('auth:logout', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Log Out', 'Stay Logged In'],
      defaultId: 1,
      cancelId: 1,
      message: 'Log out of Southbag?',
      detail: 'Every shell in every Southbag Terminal window will be terminated.',
    });
    track('terminal_logout_prompt', { confirmed: response === 0, open_shells: ptys.count });
    if (response !== 0) return false;
    await auth.logout();
    setSignedOut('user');
    return true;
  });

  ipcMain.handle('pty:create', (event, options) => {
    requireSignedIn();
    return ptys.create(event.sender, options);
  });
  ipcMain.on('pty:write', (event, id, data) => {
    if (authStatus === 'signed-in') ptys.write(event.sender, id, data);
  });
  ipcMain.on('pty:resize', (event, id, cols, rows) => ptys.resize(event.sender, id, cols, rows));
  ipcMain.on('pty:kill', (event, id) => ptys.kill(event.sender, id));

  ipcMain.handle('clipboard:read', () => {
    requireSignedIn();
    return clipboard.readText();
  });
  ipcMain.on('clipboard:write', (_event, text) => {
    if (typeof text === 'string') clipboard.writeText(text);
  });
  ipcMain.on('app:open-external', (_event, url) => openExternal(url, 'renderer'));

  ipcMain.on('palantir:capture', (_event, name, properties) => {
    if (typeof name !== 'string' || !/^[a-z0-9_$]{1,80}$/.test(name)) return;
    const safe = {};
    for (const [key, value] of Object.entries(properties && typeof properties === 'object' ? properties : {})) {
      if (['string', 'number', 'boolean'].includes(typeof value)) safe[key] = value;
    }
    track(name.startsWith('terminal_') ? name : `terminal_${name}`, safe);
  });
}

function watchSystem() {
  powerMonitor.on('suspend', () => track('terminal_system_suspend'));
  powerMonitor.on('resume', () => track('terminal_system_resume'));
  powerMonitor.on('lock-screen', () => track('terminal_system_lock'));
  powerMonitor.on('unlock-screen', () => track('terminal_system_unlock'));
  powerMonitor.on('on-ac', () => track('terminal_power_source', { source: 'ac' }));
  powerMonitor.on('on-battery', () => track('terminal_power_source', { source: 'battery' }));
  nativeTheme.on('updated', () =>
    track('terminal_system_theme_changed', { dark: nativeTheme.shouldUseDarkColors }),
  );
  screen.on('display-added', () => track('terminal_display_changed', { change: 'added' }));
  screen.on('display-removed', () => track('terminal_display_changed', { change: 'removed' }));
  app.on('browser-window-created', () => track('terminal_browser_window_created'));
  app.on('child-process-gone', (_event, details) =>
    track('terminal_child_process_gone', { type: details.type, reason: details.reason }),
  );

  // While signed in, keep checking the account is still good. When Identity says no, the shells go.
  setInterval(async () => {
    if (authStatus !== 'signed-in') return;
    const ok = await auth.ensureFresh();
    if (!ok) setSignedOut('session_expired');
  }, SESSION_CHECK_MS).unref();
}

process.on('uncaughtException', (error) => {
  palantir.error('uncaught_exception', error);
  console.error(error);
});
process.on('unhandledRejection', (error) => {
  palantir.error('unhandled_rejection', error);
  console.error(error);
});

app.whenReady().then(() => {
  const dataDir = app.getPath('userData');
  palantir.configure({ dataDir, version: VERSION });
  palantir.setBase({ locale: app.getLocale(), packaged: app.isPackaged });
  track('terminal_app_launched', {
    cold_start_ms: Math.round(process.uptime() * 1000),
    displays: screen.getAllDisplays().length,
    dark_mode: nativeTheme.shouldUseDarkColors,
  });

  auth = new SouthbagAuth({
    dataDir,
    safeStorage,
    openExternal: (url) => shell.openExternal(url),
    track,
  });
  ptys = new PtyManager({ track });
  restoring = restoreSession();

  registerIpc();
  buildMenu();
  watchSystem();
  createWindow();

  app.on('activate', () => {
    track('terminal_app_activated');
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!IS_MAC) app.quit();
});

app.on('before-quit', async (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  track('terminal_app_quit', { open_shells: ptys?.count ?? 0, uptime_ms: Math.round(process.uptime() * 1000) });
  ptys?.killAll();
  await Promise.race([palantir.flush(), new Promise((resolve) => setTimeout(resolve, 2000))]);
  app.quit();
});

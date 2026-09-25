/* global Terminal, FitAddon, WebLinksAddon, Unicode11Addon */
'use strict';

const api = window.southbag;
const $ = (id) => document.getElementById(id);
const capture = (event, properties) => api.palantir.capture(event, properties || {});

const THEMES = {
  light: {
    background: '#ffffff',
    foreground: '#212529',
    cursor: '#0d6efd',
    cursorAccent: '#ffffff',
    selectionBackground: 'rgba(13, 110, 253, 0.25)',
    black: '#212529',
    red: '#b3261e',
    green: '#137333',
    yellow: '#b26a00',
    blue: '#0d6efd',
    magenta: '#8e24aa',
    cyan: '#00838f',
    white: '#cfd8dc',
    brightBlack: '#546e7a',
    brightRed: '#e53935',
    brightGreen: '#2e7d32',
    brightYellow: '#ff9800',
    brightBlue: '#3d8bfd',
    brightMagenta: '#ab47bc',
    brightCyan: '#0097a7',
    brightWhite: '#eceff1',
  },
  dark: {
    background: '#0b0f19',
    foreground: '#e0e0e0',
    cursor: '#ff9800',
    cursorAccent: '#0b0f19',
    selectionBackground: 'rgba(13, 110, 253, 0.45)',
    black: '#1c1f26',
    red: '#ef5350',
    green: '#66bb6a',
    yellow: '#ffca28',
    blue: '#3d8bfd',
    magenta: '#ce93d8',
    cyan: '#4dd0e1',
    white: '#cfd8dc',
    brightBlack: '#78909c',
    brightRed: '#ff8a80',
    brightGreen: '#b9f6ca',
    brightYellow: '#ffe57f',
    brightBlue: '#82b1ff',
    brightMagenta: '#ea80fc',
    brightCyan: '#84ffff',
    brightWhite: '#ffffff',
  },
};

const DEFAULT_FONT_SIZE = 14;
const prefs = loadPrefs();

function loadPrefs() {
  try {
    return { fontSize: DEFAULT_FONT_SIZE, dark: false, ...JSON.parse(localStorage.getItem('prefs') || '{}') };
  } catch {
    return { fontSize: DEFAULT_FONT_SIZE, dark: false };
  }
}

function savePrefs() {
  try {
    localStorage.setItem('prefs', JSON.stringify(prefs));
  } catch {}
}

if (api.platform === 'darwin') document.body.classList.add('mac');
document.body.classList.toggle('dark-mode', prefs.dark);

// ---------------------------------------------------------------------------
// Analytics for the chrome: every button click, and aggregate terminal activity.
// Never what was typed, printed, copied or pasted — only counts.
// ---------------------------------------------------------------------------

document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  capture('terminal_ui_click', {
    element: button.dataset.track || button.id || button.className || 'button',
    view: currentView,
  });
  if (button.dataset.href) api.openExternal(button.dataset.href);
});

const activity = { keystrokes: 0, outputBytes: 0, pastes: 0, copies: 0 };
setInterval(() => {
  if (!activity.keystrokes && !activity.outputBytes) return;
  capture('terminal_activity', {
    keystrokes: activity.keystrokes,
    output_bytes: activity.outputBytes,
    pastes: activity.pastes,
    copies: activity.copies,
    open_tabs: tabs.length,
    window_focused: document.hasFocus(),
  });
  activity.keystrokes = activity.outputBytes = activity.pastes = activity.copies = 0;
}, 60_000);

window.addEventListener('error', (event) =>
  capture('terminal_error', { source: 'renderer', message: String(event.message || 'error') }),
);
window.addEventListener('unhandledrejection', (event) =>
  capture('terminal_error', { source: 'renderer_promise', message: String(event.reason?.message || event.reason) }),
);
document.addEventListener('visibilitychange', () =>
  capture('terminal_visibility_changed', { visible: document.visibilityState === 'visible' }),
);

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

let currentView = 'loading';
let user = null;

function showView(name) {
  if (currentView === name) return;
  currentView = name;
  $('login').hidden = name !== 'login';
  $('app').hidden = name !== 'app';
  document.body.classList.remove('loading');
  capture('terminal_view_shown', { view: name });
}

function setLoginStatus(text, isError = false) {
  const status = $('loginStatus');
  status.textContent = text;
  status.classList.toggle('error', isError);
}

function applyAuth({ status, user: nextUser }) {
  if (status === 'signed-in' && nextUser) {
    user = nextUser;
    $('accountName').textContent = user.name || user.email || 'Southbag customer';
    $('accountName').title = user.email || '';
    showView('app');
    if (tabs.length === 0) newTab('auto');
    return;
  }
  user = null;
  closeAllTabs();
  $('offlinePanel').hidden = status !== 'offline';
  if (status === 'signed-out') setLoginStatus('');
  if (status === 'offline') setLoginStatus('Southbag Identity is unreachable.', true);
  showView('login');
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('loginButton').disabled = true;
  $('cancelButton').hidden = false;
  setLoginStatus('Complete your login in the browser window that just opened…');
  const result = await api.auth.login();
  $('loginButton').disabled = false;
  $('cancelButton').hidden = true;
  if (!result.ok) {
    setLoginStatus(result.code === 'cancelled' ? 'Login cancelled. The terminal remains locked.' : `Login failed: ${result.message}`, result.code !== 'cancelled');
  }
});

$('cancelButton').addEventListener('click', () => api.auth.cancel());
$('retryButton').addEventListener('click', () => location.reload());
$('logoutButton').addEventListener('click', () => api.auth.logout());
$('darkModeToggle').addEventListener('click', () => {
  prefs.dark = !prefs.dark;
  savePrefs();
  document.body.classList.toggle('dark-mode', prefs.dark);
  for (const tab of tabs) tab.term.options.theme = THEMES[prefs.dark ? 'dark' : 'light'];
  activeTab?.term.focus();
  capture('terminal_theme_changed', { dark: prefs.dark });
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

/** @type {Array<{ key: number, ptyId: number|null, term: any, fit: any, el: HTMLElement, pane: HTMLElement, title: string, openedAt: number, exited: boolean, observer: ResizeObserver }>} */
const tabs = [];
let activeTab = null;
let tabKey = 0;
const byPty = new Map();

async function newTab(source) {
  if (!user) return;
  const key = ++tabKey;
  const pane = document.createElement('div');
  pane.className = 'terminal-pane';
  $('terminals').appendChild(pane);

  const term = new Terminal({
    fontFamily: '"SF Mono", Menlo, "DejaVu Sans Mono", "Liberation Mono", Consolas, monospace',
    fontSize: prefs.fontSize,
    lineHeight: 1.15,
    cursorBlink: true,
    allowProposedApi: true,
    scrollback: 10_000,
    theme: THEMES[prefs.dark ? 'dark' : 'light'],
    macOptionIsMeta: true,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new Unicode11Addon.Unicode11Addon());
  term.unicode.activeVersion = '11';
  term.loadAddon(new WebLinksAddon.WebLinksAddon((event, uri) => {
    if (event.metaKey || event.ctrlKey || api.platform !== 'darwin') api.openExternal(uri);
  }));
  term.open(pane);

  const el = document.createElement('div');
  el.className = 'tab';
  el.setAttribute('role', 'tab');
  el.innerHTML = '<span class="tab-title"></span><button type="button" class="tab-close" data-track="tab_close_button" title="Close tab">x</button>';
  el.addEventListener('mousedown', (event) => {
    // Keep keyboard focus in the terminal when clicking tabs.
    event.preventDefault();
    if (event.button === 1) {
      event.preventDefault();
      closeTab(tab, 'middle_click');
    }
  });
  el.addEventListener('click', (event) => {
    if (event.target.closest('.tab-close')) closeTab(tab, 'close_button');
    else activate(tab, 'click');
  });
  $('tabs').appendChild(el);

  const tab = { key, ptyId: null, term, fit, el, pane, title: 'shell', openedAt: Date.now(), exited: false, titleChanges: 0 };
  tabs.push(tab);
  setTitle(tab, 'Starting…');
  activate(tab, source);

  term.onData((data) => {
    if (tab.ptyId == null || tab.exited) return;
    activity.keystrokes += 1;
    api.pty.write(tab.ptyId, data);
  });
  term.onBinary((data) => tab.ptyId != null && api.pty.write(tab.ptyId, data));
  term.onTitleChange((title) => {
    tab.titleChanges += 1;
    setTitle(tab, title || tab.shell || 'shell');
  });
  term.onBell(() => {
    capture('terminal_bell', { active: tab === activeTab });
    if (tab !== activeTab) {
      el.classList.remove('bell');
      void el.offsetWidth;
      el.classList.add('bell');
    }
  });
  term.onSelectionChange(() => {
    if (term.hasSelection()) tab.selections = (tab.selections || 0) + 1;
  });
  let resizeTimer;
  term.onResize(({ cols, rows }) => {
    if (tab.ptyId != null) api.pty.resize(tab.ptyId, cols, rows);
    if (tab === activeTab) updateStatus();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => capture('terminal_resized', { cols, rows }), 1500);
  });
  tab.observer = new ResizeObserver(() => refit(tab));
  tab.observer.observe(pane);

  refit(tab);
  try {
    const { id, shell } = await api.pty.create({ cols: term.cols, rows: term.rows });
    if (!tabs.includes(tab)) {
      api.pty.kill(id);
      return;
    }
    tab.ptyId = id;
    tab.shell = shell;
    byPty.set(id, tab);
    if (tab.title === 'Starting…') setTitle(tab, shell);
    updateStatus();
    capture('terminal_tab_opened', { source, open_tabs: tabs.length, shell });
  } catch (error) {
    term.write(`\r\n\x1b[31mSouthbag Terminal could not start a shell: ${error.message}\x1b[0m\r\n`);
    tab.exited = true;
    el.classList.add('exited');
    capture('terminal_tab_open_failed', { source, message: error.message });
  }
}

function refit(tab) {
  if (tab.pane.clientWidth === 0 || tab.pane.clientHeight === 0) return;
  try {
    tab.fit.fit();
  } catch {}
}

function setTitle(tab, title) {
  tab.title = title;
  tab.el.querySelector('.tab-title').textContent = title;
  tab.el.title = title;
  if (tab === activeTab) document.title = `${title} — Southbag Terminal`;
}

function activate(tab, method) {
  if (!tab) return;
  const previous = activeTab;
  activeTab = tab;
  for (const t of tabs) {
    const active = t === tab;
    t.el.classList.toggle('active', active);
    t.el.setAttribute('aria-selected', String(active));
    t.pane.classList.toggle('active', active);
  }
  tab.el.classList.remove('bell');
  tab.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  document.title = `${tab.title} — Southbag Terminal`;
  tab.term.focus();
  requestAnimationFrame(() => refit(tab));
  updateStatus();
  if (previous && previous !== tab && method) {
    capture('terminal_tab_switched', { method, index: tabs.indexOf(tab) + 1, open_tabs: tabs.length });
  }
}

function closeTab(tab, reason) {
  const index = tabs.indexOf(tab);
  if (index === -1) return;
  tabs.splice(index, 1);
  if (tab.ptyId != null) {
    byPty.delete(tab.ptyId);
    if (!tab.exited) api.pty.kill(tab.ptyId);
  }
  tab.observer.disconnect();
  tab.term.dispose();
  tab.pane.remove();
  tab.el.remove();
  capture('terminal_tab_closed', {
    reason,
    lifetime_ms: Date.now() - tab.openedAt,
    title_changes: tab.titleChanges,
    selections: tab.selections || 0,
    open_tabs: tabs.length,
  });
  if (activeTab === tab) {
    activeTab = null;
    activate(tabs[Math.min(index, tabs.length - 1)]);
  }
  if (tabs.length === 0 && user && reason !== 'signed_out') window.close();
}

function closeAllTabs() {
  for (const tab of [...tabs]) closeTab(tab, 'signed_out');
}

function updateStatus() {
  if (!activeTab) return;
  $('statusShell').textContent = activeTab.shell || '';
  $('statusSize').textContent = `${activeTab.term.cols}×${activeTab.term.rows}`;
}

$('newTab').addEventListener('click', () => newTab('button'));
$('tabs').addEventListener('dblclick', (event) => {
  if (event.target === $('tabs')) newTab('tab_bar_double_click');
});

api.pty.onData((id, data) => {
  const tab = byPty.get(id);
  if (!tab) return;
  activity.outputBytes += data.length;
  tab.term.write(data);
});

api.pty.onExit((id, { exitCode }) => {
  const tab = byPty.get(id);
  if (!tab) return;
  tab.exited = true;
  if (exitCode === 0) {
    closeTab(tab, 'shell_exited');
    return;
  }
  tab.el.classList.add('exited');
  tab.term.write(`\r\n\x1b[2m[process exited with code ${exitCode} — press any key to close this tab]\x1b[0m`);
  const once = tab.term.onKey(() => {
    once.dispose();
    closeTab(tab, 'shell_exited_ack');
  });
});

// ---------------------------------------------------------------------------
// Menu actions and shortcuts
// ---------------------------------------------------------------------------

function cycle(step) {
  if (tabs.length < 2) return;
  const index = tabs.indexOf(activeTab);
  activate(tabs[(index + step + tabs.length) % tabs.length], 'shortcut');
}

function setFontSize(size) {
  prefs.fontSize = Math.max(8, Math.min(40, size));
  savePrefs();
  for (const tab of tabs) {
    tab.term.options.fontSize = prefs.fontSize;
    refit(tab);
  }
  capture('terminal_font_size_changed', { font_size: prefs.fontSize });
}

api.onMenu(async (action) => {
  if (action === 'logout') return api.auth.logout();
  if (currentView !== 'app') return;
  const term = activeTab?.term;
  switch (action) {
    case 'new-tab':
      return newTab('shortcut');
    case 'close-tab':
      return activeTab && closeTab(activeTab, 'shortcut');
    case 'next-tab':
      return cycle(1);
    case 'prev-tab':
      return cycle(-1);
    case 'copy': {
      const text = term?.getSelection();
      if (text) {
        api.clipboard.write(text);
        activity.copies += 1;
        capture('terminal_copy', { characters: text.length });
      }
      return;
    }
    case 'paste': {
      if (!term || !activeTab.ptyId) return;
      const text = await api.clipboard.read();
      if (text) {
        term.paste(text);
        activity.pastes += 1;
        capture('terminal_paste', { characters: text.length, lines: text.split('\n').length });
      }
      return;
    }
    case 'select-all':
      return term?.selectAll();
    case 'clear':
      term?.clear();
      return capture('terminal_scrollback_cleared');
    case 'font-bigger':
      return setFontSize(prefs.fontSize + 1);
    case 'font-smaller':
      return setFontSize(prefs.fontSize - 1);
    case 'font-reset':
      return setFontSize(DEFAULT_FONT_SIZE);
    default: {
      const match = /^tab-(\d)$/.exec(action);
      if (match) activate(tabs[Number(match[1]) - 1], 'shortcut');
    }
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

api.auth.onChange(applyAuth);
api.auth.state().then(applyAuth);

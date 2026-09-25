/**
 * Owns the shells. Every PTY belongs to the webContents that asked for it, so a closed
 * window (or a sign-out) takes its shells down with it.
 *
 * Analytics only ever see counts and durations from here — never what was typed or printed.
 */

const os = require('node:os');
const path = require('node:path');
const pty = require('node-pty');

function defaultShell() {
  if (process.env.SHELL) return process.env.SHELL;
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
}

class PtyManager {
  constructor({ track }) {
    this.track = track;
    this.sessions = new Map();
    this.nextId = 1;
  }

  create(webContents, { cols = 80, rows = 24, cwd } = {}) {
    const shell = defaultShell();
    const id = this.nextId++;
    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'SouthbagTerminal',
      TERM_PROGRAM_VERSION: require('../../package.json').version,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const proc = pty.spawn(shell, process.platform === 'win32' ? [] : ['-l'], {
      name: 'xterm-256color',
      cols: Math.max(1, cols | 0),
      rows: Math.max(1, rows | 0),
      cwd: cwd || os.homedir(),
      env,
    });
    const session = {
      id,
      proc,
      webContents,
      startedAt: Date.now(),
      bytesIn: 0,
      bytesOut: 0,
      writes: 0,
      resizes: 0,
      killed: false,
    };
    this.sessions.set(id, session);

    proc.onData((data) => {
      session.bytesOut += data.length;
      if (!webContents.isDestroyed()) webContents.send('pty:data', id, data);
    });
    proc.onExit(({ exitCode, signal }) => {
      this.sessions.delete(id);
      this.track('terminal_shell_exited', {
        ...this.stats(session),
        exit_code: exitCode,
        signal: signal || undefined,
        killed_by_app: session.killed,
      });
      if (!webContents.isDestroyed()) webContents.send('pty:exit', id, { exitCode, signal });
    });

    this.track('terminal_shell_spawned', {
      shell: path.basename(shell),
      cols: proc.cols,
      rows: proc.rows,
      open_shells: this.sessions.size,
    });
    return { id, shell: path.basename(shell), pid: proc.pid };
  }

  owned(webContents, id) {
    const session = this.sessions.get(id);
    return session && session.webContents === webContents ? session : null;
  }

  write(webContents, id, data) {
    const session = this.owned(webContents, id);
    if (!session || typeof data !== 'string') return;
    session.bytesIn += data.length;
    session.writes += 1;
    session.proc.write(data);
  }

  resize(webContents, id, cols, rows) {
    const session = this.owned(webContents, id);
    if (!session || !(cols > 0) || !(rows > 0)) return;
    session.resizes += 1;
    try {
      session.proc.resize(cols | 0, rows | 0);
    } catch {}
  }

  kill(webContents, id) {
    const session = this.owned(webContents, id);
    if (session) this.terminate(session);
  }

  killAllFor(webContents) {
    for (const session of this.sessions.values()) {
      if (session.webContents === webContents) this.terminate(session);
    }
  }

  killAll() {
    for (const session of this.sessions.values()) this.terminate(session);
  }

  terminate(session) {
    session.killed = true;
    try {
      session.proc.kill();
    } catch {}
  }

  stats(session) {
    return {
      lifetime_ms: Date.now() - session.startedAt,
      bytes_in: session.bytesIn,
      bytes_out: session.bytesOut,
      writes: session.writes,
      resizes: session.resizes,
      open_shells: this.sessions.size,
    };
  }

  get count() {
    return this.sessions.size;
  }
}

module.exports = { PtyManager, defaultShell };

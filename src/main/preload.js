const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('southbag', {
  platform: process.platform,

  auth: {
    state: () => ipcRenderer.invoke('auth:state'),
    login: () => ipcRenderer.invoke('auth:login'),
    cancel: () => ipcRenderer.invoke('auth:cancel'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    onChange: (callback) => subscribe('auth:changed', callback),
  },

  pty: {
    create: (options) => ipcRenderer.invoke('pty:create', options),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onData: (callback) => subscribe('pty:data', callback),
    onExit: (callback) => subscribe('pty:exit', callback),
  },

  clipboard: {
    read: () => ipcRenderer.invoke('clipboard:read'),
    write: (text) => ipcRenderer.send('clipboard:write', text),
  },

  openExternal: (url) => ipcRenderer.send('app:open-external', url),
  onMenu: (callback) => subscribe('menu:action', callback),

  palantir: {
    capture: (event, properties) => ipcRenderer.send('palantir:capture', event, properties),
  },
});

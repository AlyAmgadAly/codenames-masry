const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('masry', {
  isDesktop: true,
  get: (name, fallback) => ipcRenderer.invoke('store:get', name, fallback),
  set: (name, value) => ipcRenderer.invoke('store:set', name, value),
  info: () => ipcRenderer.invoke('app:info'),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  open: (url) => ipcRenderer.invoke('shell:open', url),
  exportPacks: (payload) => ipcRenderer.invoke('packs:export', payload),
  importPacks: () => ipcRenderer.invoke('packs:import')
});

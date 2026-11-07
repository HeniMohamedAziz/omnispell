const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('omnispellDesktop', {
  isDesktopApp: true,
  speakNative: (text, rate) => ipcRenderer.invoke('omnispell:speak-native', { text, rate }),
  loadDatabase: () => ipcRenderer.invoke('omnispell:load-db'),
  saveDatabase: (data) => ipcRenderer.invoke('omnispell:save-db', data)
});

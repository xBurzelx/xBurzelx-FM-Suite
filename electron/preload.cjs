const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Version ---
  getVersion: () => ipcRenderer.invoke('app:get-version'),

  // --- Bestehende Methoden ---
  saveData: (key, data) => ipcRenderer.invoke('app:save-data', { key, data }),
  loadData: (key) => ipcRenderer.invoke('app:load-data', key),

  // --- Methoden für FM-Downloads & Ordner-Zugriff ---
  downloadFile: (data) => ipcRenderer.invoke('download-file', data),
  openFolder: (groupName) => ipcRenderer.invoke('open-folder', groupName),
  getFmFolderPath: (groupName) => ipcRenderer.invoke('get-fm-path', groupName),

  // --- Config.xml Generator ---
  selectFacepackFolder: () => ipcRenderer.invoke('select-facepack-folder'),
  processFacepack: (folderPath) => ipcRenderer.invoke('process-facepack', folderPath),
  openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),
  onProcessProgress: (callback) => {
    ipcRenderer.removeAllListeners('process-progress');
    ipcRenderer.on('process-progress', (event, data) => callback(data));
  },

  // --- Auto-Updater Methoden ---
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  onUpdateStatus: (callback) => {
    ipcRenderer.removeAllListeners('update-status');
    ipcRenderer.on('update-status', (event, data) => callback(data));
  }
});
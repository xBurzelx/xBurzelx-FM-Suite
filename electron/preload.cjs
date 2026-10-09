const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Bestehende Methoden ---
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  saveData: (key, data) => ipcRenderer.invoke('app:save-data', { key, data }),
  loadData: (key) => ipcRenderer.invoke('app:load-data', key),

  // --- Neue Methoden für FM-Downloads & Ordner-Zugriff ---
  downloadFile: (data) => ipcRenderer.invoke('download-file', data),
  openFolder: (groupName) => ipcRenderer.invoke('open-folder', groupName),

  // --- Hilfreiche Extras ---
  // Prüft, ob ein Ordner bereits existiert oder gibt System-Pfade zurück
  getFmFolderPath: (groupName) => ipcRenderer.invoke('get-fm-path', groupName),

// Neu für den config.xml Generator:
  selectFacepackFolder: () => ipcRenderer.invoke('select-facepack-folder'),
  processFacepack: (folderPath) => ipcRenderer.invoke('process-facepack', folderPath),
  openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),
  onProcessProgress: (callback) => {
    ipcRenderer.removeAllListeners('process-progress');
    ipcRenderer.on('process-progress', (event, data) => callback(data));
  }
});
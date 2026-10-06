const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('StudinixDesktop', {
  isElectron: true,
  platform: process.platform,
  
  // Dual-Window & Drop Note Controls
  toggleDropNote: () => ipcRenderer.invoke('toggle-dropnote'),
  hideDropNote: () => ipcRenderer.invoke('hide-dropnote'),
  setDropNoteCollapsed: (collapsed) => ipcRenderer.invoke('set-dropnote-collapsed', collapsed),
  notifyTasksUpdated: () => ipcRenderer.send('notify-tasks-updated'),

  // Listen for cross-window sync
  onTasksSynced: (callback) => {
    ipcRenderer.on('sync-tasks', () => callback());
  },

  // Cross-Window User Session Sync
  notifyUserChanged: (userData) => ipcRenderer.send('notify-user-changed', userData),
  onUserChanged: (callback) => {
    ipcRenderer.on('user-changed', (event, data) => callback(data));
  }
});


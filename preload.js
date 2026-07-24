const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    runSumo: (opts) => ipcRenderer.invoke('run-sumo', opts),
    runSumoHeadless: (opts) => ipcRenderer.invoke('run-sumo-headless', opts),
    writeProjectFile: (opts) => ipcRenderer.invoke('write-project-file', opts),
    readProjectFile: (opts) => ipcRenderer.invoke('read-project-file', opts)
});

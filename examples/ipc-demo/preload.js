// Runs in Bunmaska's isolated preload world (Electron contextIsolation). It is
// injected verbatim, so keep it plain JS. Two globals are available here:
//   contextBridge.exposeInMainWorld(key, api)  — expose a safe surface to the page
//   __bunmaska.invoke(channel, ...args)          — call an ipcMain.handle handler
contextBridge.exposeInMainWorld('api', {
  ping: (message) => __bunmaska.invoke('ping', message),
});

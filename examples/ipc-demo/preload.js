// Runs in Bunmaska's isolated preload world (Electron contextIsolation). It is
// bundled before injection, so you can import modules — keep it browser code
// (no Node APIs). Two globals are available here:
//   contextBridge.exposeInMainWorld(key, api)  — expose a safe surface to the page
//   __bunmaska.invoke(channel, ...args)          — call an ipcMain.handle handler
contextBridge.exposeInMainWorld('api', {
  ping: (message) => __bunmaska.invoke('ping', message),
});

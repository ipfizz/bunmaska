// Runs in the isolated preload world, where two globals are injected:
//   contextBridge.exposeInMainWorld(key, api): expose a safe surface to the page
//   __bunmaska.invoke(channel, ...args): call an ipcMain.handle handler
contextBridge.exposeInMainWorld('api', {
  ping: (message) => __bunmaska.invoke('ping', message),
});

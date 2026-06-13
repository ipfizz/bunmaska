/**
 * Sambar "IPC demo" — contextBridge + ipcMain.handle end-to-end.
 *
 * Run from the repo root with:  bun examples/ipc-demo/main.ts
 *
 * The isolated preload exposes a typed `window.api` to the page; clicking the
 * button invokes `ipcMain.handle('ping')` in the main process and shows the
 * reply. This is the canonical secure IPC pattern (contextIsolation on).
 */
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from '../../src/main';

ipcMain.handle('ping', (_event, message: unknown) => `pong: ${String(message)}`);

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 720,
    height: 540,
    title: 'Sambar IPC Demo',
    webPreferences: {
      preload: join(import.meta.dir, 'preload.js'),
    },
  });
  win.loadFile(join(import.meta.dir, 'index.html'));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

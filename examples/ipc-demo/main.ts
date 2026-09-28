/** Secure IPC end to end. Run from the repo root: bun examples/ipc-demo/main.ts */
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from '../../src/main';

ipcMain.handle('ping', (_event, message: unknown) => `pong: ${String(message)}`);

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 720,
    height: 540,
    title: 'Bunmaska IPC Demo',
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

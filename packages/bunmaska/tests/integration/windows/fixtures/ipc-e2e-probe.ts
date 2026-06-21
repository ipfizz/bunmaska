/**
 * Subprocess fixture: the full public-API end-to-end path on Windows. Creates a
 * real `BrowserWindow`, loads a page, and confirms a renderer `__bunmaska.invoke`
 * round-trips through `ipcMain.handle` and back — exercising the whole stack
 * (app -> WindowsApplication -> WindowsWindow -> WindowsWebContents -> the bridge).
 * Prints `E2E_OK "<result>"` on success. Requires BUNMASKA_WEBKIT_PATH.
 */
import { app, BrowserWindow, ipcMain } from '../../../../src/index';

const finish = (line: string, code: number): never => {
  process.stdout.write(`${line}\n`);
  process.exit(code);
};

setTimeout(() => finish('E2E_FAIL timeout', 1), 25000);

ipcMain.handle('ping', (_event, arg: unknown) => `pong:${arg}`);

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 800, height: 600, show: false });
  // Waiting on did-finish-load (the navigation client) before invoking also
  // exercises the WKPageNavigationClient wiring.
  win.webContents.once('did-finish-load', () => {
    win.webContents
      .executeJavaScript("__bunmaska.invoke('ping', 'x')")
      .then((result) => finish(`E2E_OK ${JSON.stringify(result)}`, 0))
      .catch((error) => finish(`E2E_FAIL ${String(error)}`, 1));
  });
  win.loadURL('data:text/html,<!doctype html><html><body>bunmaska</body></html>');
});

/**
 * Subprocess fixture: a real BrowserWindow loads a page, then closes — proving
 * the WebKit-view teardown on window close is crash-free. The `window-all-closed`
 * listener keeps the app alive so this isolates the window close from app-exit
 * (synchronous WebKit shutdown at process exit is a separate, documented item).
 * Prints `CLOSE_OK` if the process survives the close. Requires BUNMASKA_WEBKIT_PATH.
 */
import { app, BrowserWindow } from '../../../../src/index';

const finish = (line: string, code: number): never => {
  process.stdout.write(`${line}\n`);
  process.exit(code);
};

setTimeout(() => finish('CLOSE_FAIL timeout', 1), 20000);

app.on('window-all-closed', () => {
  // Keep the app running so this measures only the window close.
});

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 800, height: 600, show: false });
  win.webContents.once('did-finish-load', () => {
    win.close();
    // If close tore down the live WebKit view cleanly, we get here without a crash.
    setTimeout(() => finish('CLOSE_OK', 0), 600);
  });
  win.loadURL('data:text/html,<!doctype html><html><body>bye</body></html>');
});

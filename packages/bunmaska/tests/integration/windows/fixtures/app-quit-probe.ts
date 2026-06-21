/**
 * Subprocess fixture: a real app loads a page, closes its only window, and lets
 * the default window-all-closed -> app.quit fire — exercising process exit with a
 * LIVE WinCairo engine. The clean-exit handler hard-terminates before WebKit's
 * crashy static teardown, so this must exit 0 (a crash would be a non-zero code).
 * Requires BUNMASKA_WEBKIT_PATH.
 */
import { app, BrowserWindow } from '../../../../src/index';

setTimeout(() => process.exit(2), 15000);

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 800, height: 600, show: false });
  win.webContents.once('did-finish-load', () => {
    process.stdout.write('QUITTING\n');
    win.close(); // -> window-all-closed -> app.quit -> clean process exit
  });
  win.loadURL('data:text/html,<!doctype html><html><body>bye</body></html>');
});

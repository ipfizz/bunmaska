/**
 * Subprocess fixture: with BUNMASKA_DEV=1 the BrowserWindow constructor installs
 * the stdin reload listener. The probe loads a page, prints DEV_RELOAD_READY, and
 * when the test writes `reload` on stdin the page reloads (did-finish-load fires
 * again) and it prints DEV_RELOAD_OK — proving the live-reload chain end to end.
 * Requires BUNMASKA_WEBKIT_PATH.
 */
import { app, BrowserWindow } from '../../../../src/index';

const finish = (line: string, code: number): never => {
  process.stdout.write(`${line}\n`);
  process.exit(code);
};
setTimeout(() => finish('DEV_RELOAD_FAIL timeout', 1), 25000);

let loads = 0;
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 480, height: 320, show: false });
  win.webContents.on('did-finish-load', () => {
    loads += 1;
    if (loads === 1) {
      // First load done — ask the test to send a reload command on stdin.
      process.stdout.write('DEV_RELOAD_READY\n');
    } else {
      // A second navigation means the stdin `reload` reloaded the page in place.
      finish('DEV_RELOAD_OK', 0);
    }
  });
  win.loadURL('data:text/html,<!doctype html><html><body>dev reload</body></html>');
});

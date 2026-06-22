/**
 * Subprocess fixture: the application menu BAR coexisting with a LIVE WebKit view.
 * Sets an application menu, then creates a real `BrowserWindow`, loads a page, and
 * confirms `executeJavaScript` still works — proving that attaching the menu bar
 * (which shrinks the client area and triggers a view resize) does not disturb the
 * hosted WKView, and that the JSCallback frame proc keeps driving the runtime.
 * Prints `MENU_ENGINE_OK <result>` on success. Requires BUNMASKA_WEBKIT_PATH.
 */
import { app, BrowserWindow, Menu } from '../../../../src/index';

const finish = (line: string, code: number): never => {
  process.stdout.write(`${line}\n`);
  process.exit(code);
};

setTimeout(() => finish('MENU_ENGINE_FAIL timeout', 1), 25000);

app.whenReady().then(() => {
  // Set the app menu BEFORE the window exists — the window picks it up on creation.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'File', submenu: [{ label: 'Quit', click: () => undefined }] },
      { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'paste' }] },
    ]),
  );
  const win = new BrowserWindow({ width: 800, height: 600, show: true });
  win.webContents.once('did-finish-load', () => {
    win.webContents
      .executeJavaScript('2 + 3')
      .then((result) => finish(`MENU_ENGINE_OK ${JSON.stringify(result)}`, 0))
      .catch((error) => finish(`MENU_ENGINE_FAIL ${String(error)}`, 1));
  });
  win.loadURL('data:text/html,<!doctype html><html><body>bunmaska menu</body></html>');
});

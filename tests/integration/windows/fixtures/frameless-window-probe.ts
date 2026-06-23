/**
 * Frameless window + custom title bar probe. Verifies, end to end:
 *   - `frame: false` opens a borderless window,
 *   - the built-in `window.__bunmaska.window` controls are injected,
 *   - the `--app-region` drag-region cascade works (bar = drag, button = no-drag),
 *   - the window-op channel works renderer -> main -> native: closing through
 *     `window.__bunmaska.window.close()` ends the app (a fast clean exit).
 * Prints `FRAMELESS_OK <json>` then exits via the close op. Requires BUNMASKA_WEBKIT_PATH.
 */
import { app, BrowserWindow } from '../../../../src/main';

const html = `<!doctype html><html><head><style>
  #bar { --app-region: drag; }
  #bar button { --app-region: no-drag; }
</style></head><body><div id="bar">title<button id="b">x</button></div></body></html>`;

const finish = (line: string, code: number): never => {
  process.stdout.write(`${line}\n`);
  process.exit(code);
};
setTimeout(() => finish('FRAMELESS_FAIL timeout (close op channel did not fire)', 1), 25000);

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 320, height: 240, frame: false, show: true });
  win.webContents.once('did-finish-load', async () => {
    try {
      const probe = await win.webContents.executeJavaScript(`JSON.stringify({
        controls: typeof window.__bunmaska?.window?.minimize === 'function'
          && typeof window.__bunmaska.window.close === 'function'
          && typeof window.__bunmaska.window.toggleMaximize === 'function',
        barRegion: getComputedStyle(document.getElementById('bar')).getPropertyValue('--app-region').trim(),
        btnRegion: getComputedStyle(document.getElementById('b')).getPropertyValue('--app-region').trim()
      })`);
      process.stdout.write(`FRAMELESS_OK ${probe}\n`);
      // Drive the window-op channel: close through the built-in control. If it works
      // the window closes -> window-all-closed -> app.quit -> this process exits 0.
      await win.webContents.executeJavaScript('window.__bunmaska.window.close()');
    } catch (e) {
      finish(`FRAMELESS_FAIL ${String(e)}`, 1);
    }
  });
  win.loadURL(`data:text/html,${encodeURIComponent(html)}`);
});

app.on('window-all-closed', () => {
  app.quit();
});

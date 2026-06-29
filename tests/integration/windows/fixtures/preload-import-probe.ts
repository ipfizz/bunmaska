/**
 * Subprocess fixture: a preload that IMPORTS a sibling module still exposes
 * `window.api`. A preload is injected as a classic script (no module mode), so
 * without bundling the `import` would throw and silently kill the whole preload.
 * `loadPreloadScript` bundles it into a self-contained IIFE first. Prints
 * `PRELOAD_IMPORT_OK "<value>"` on success. Requires BUNMASKA_WEBKIT_PATH.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow } from '../../../../src/index';

const finish = (line: string, code: number): never => {
  process.stdout.write(`${line}\n`);
  process.exit(code);
};
setTimeout(() => finish('PRELOAD_IMPORT_FAIL timeout', 1), 25000);

// A preload that pulls a value out of an imported sibling module and exposes it.
const dir = mkdtempSync(join(tmpdir(), 'bunmaska-preload-import-'));
writeFileSync(join(dir, 'helper.js'), 'export const greet = (name) => `hi ${name} from helper`;\n');
const preloadPath = join(dir, 'preload.js');
writeFileSync(
  preloadPath,
  "import { greet } from './helper.js';\ncontextBridge.exposeInMainWorld('api', { greet: (n) => greet(n) });\n",
);

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 640,
    height: 480,
    show: false,
    webPreferences: { preload: preloadPath },
  });
  win.webContents.once('did-finish-load', () => {
    win.webContents
      .executeJavaScript("typeof window.api === 'object' ? window.api.greet('bun') : 'NO_API'")
      .then((result) =>
        finish(
          `PRELOAD_IMPORT_OK ${JSON.stringify(result)}`,
          result === 'hi bun from helper' ? 0 : 1,
        ),
      )
      .catch((error) => finish(`PRELOAD_IMPORT_FAIL ${String(error)}`, 1));
  });
  win.loadURL('data:text/html,<!doctype html><html><body>preload import</body></html>');
});

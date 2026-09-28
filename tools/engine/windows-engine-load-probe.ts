// Proves a relocated WinCairo engine renders when resolved from the store (run WITHOUT
// BUNMASKA_WEBKIT_PATH): nothing renders unless the whole DLL closure and helper exes
// resolved there. Prints STORE_ENGINE_OK <result> or STORE_ENGINE_FAIL <why>.
import { app, BrowserWindow } from '../../src/index';
import { resolveWindowsEngineDir } from '../../src/main/platform/windows/webkit2-ffi';

const finish = (line: string, code: number): never => {
  process.stdout.write(`${line}\n`);
  process.exit(code);
};

// Compare separator-agnostically: the resolver returns backslash paths however the env was written.
const slash = (s: string): string => s.replaceAll('\\', '/');
const store = slash(process.env['BUNMASKA_ENGINES_PATH'] ?? '');
const id = process.env['BUNMASKA_WEBKIT_ID'] ?? '';
const resolved = resolveWindowsEngineDir();
if (
  resolved === undefined ||
  store === '' ||
  !slash(resolved).startsWith(store) ||
  !resolved.includes(id)
) {
  finish(`STORE_ENGINE_FAIL engine did not resolve into the store (resolved=${resolved})`, 1);
}

setTimeout(() => finish('STORE_ENGINE_FAIL timeout', 1), 25000);

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 640, height: 480, show: false });
  win.webContents.once('did-finish-load', () => {
    win.webContents
      .executeJavaScript('6 * 7')
      .then((result) => finish(`STORE_ENGINE_OK ${JSON.stringify(result)}`, 0))
      .catch((error) => finish(`STORE_ENGINE_FAIL ${String(error)}`, 1));
  });
  win.loadURL('data:text/html,<!doctype html><html><body>store engine</body></html>');
});

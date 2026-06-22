/**
 * Build-engine probe (Windows): prove a RELOCATED WinCairo engine works when
 * resolved from the store — the peer of `engine-load-probe.ts`. Run with
 * `BUNMASKA_ENGINES_PATH` + `BUNMASKA_WEBKIT_ID` set and deliberately WITHOUT
 * `BUNMASKA_WEBKIT_PATH`, so the engine MUST be found via the store layout
 * `<root>/<id>/lib`. It then drives the full stack — a real `BrowserWindow` whose
 * WebProcess spawns from the store dir, and `executeJavaScript` round-tripping a
 * value — which is a stronger proof than merely counting loaded modules: nothing
 * renders unless the entire DLL closure + helper exes resolved from the store.
 *
 * Prints `STORE_ENGINE_OK <result>` on success, `STORE_ENGINE_FAIL ...` otherwise.
 */
import { app, BrowserWindow } from '../../src/index';
import { resolveWindowsEngineDir } from '../../src/main/platform/windows/webkit2-ffi';

const finish = (line: string, code: number): never => {
  process.stdout.write(`${line}\n`);
  process.exit(code);
};

// The engine must resolve INTO the store via the pinned id (not an env path /
// bundled dir). Compare separator-agnostically — the resolver returns Windows
// backslash paths regardless of how the env var was written.
const slash = (s: string): string => s.replaceAll('\\', '/');
const store = slash(process.env.BUNMASKA_ENGINES_PATH ?? '');
const id = process.env.BUNMASKA_WEBKIT_ID ?? '';
const resolved = resolveWindowsEngineDir();
if (resolved === undefined || store === '' || !slash(resolved).startsWith(store) || !resolved.includes(id)) {
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

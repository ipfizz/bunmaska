import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { resolveWindowsEngineDir } from '../../../src/main/platform/windows/webkit2-ffi';

/**
 * Windows + engine only. The full public-API proof: a real `BrowserWindow` loads
 * a page and a renderer `__bunmaska.invoke` round-trips through `ipcMain.handle`,
 * exercising the whole assembled backend (app -> WindowsApplication ->
 * WindowsWindow -> WindowsWebContents -> the bridge -> executeJavaScript).
 *
 * Driven in a spawned Bun subprocess (WebKit's multi-process model does not
 * coexist with the bun:test runner host). Skipped unless BUNMASKA_WEBKIT_PATH
 * points at a WinCairo engine directory.
 */
const hasEngine = currentPlatform() === 'windows' && resolveWindowsEngineDir() !== undefined;

describe.skipIf(!hasEngine)('Windows backend end-to-end', () => {
  test('a BrowserWindow round-trips ipcRenderer.invoke through ipcMain.handle', async () => {
    const fixture = `${import.meta.dir}/fixtures/ipc-e2e-probe.ts`;
    const proc = Bun.spawn([process.execPath, 'run', fixture], {
      env: { ...process.env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain('E2E_OK "pong:x"');
  }, 40000);
});

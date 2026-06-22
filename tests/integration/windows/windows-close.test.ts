import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { resolveWindowsEngineDir } from '../../../src/main/platform/windows/webkit2-ffi';

/**
 * Windows + engine only. Proves closing a `BrowserWindow` tears the live WinCairo
 * WebKit view down without crashing (the dispose path clears WebKit's clients
 * before hiding the window, so WebKit never re-enters a bun:ffi trampoline). Run
 * in a spawned subprocess; skipped unless BUNMASKA_WEBKIT_PATH is set.
 */
const hasEngine = currentPlatform() === 'windows' && resolveWindowsEngineDir() !== undefined;

describe.skipIf(!hasEngine)('Windows window close', () => {
  test('closing a BrowserWindow does not crash', async () => {
    const fixture = `${import.meta.dir}/fixtures/window-close-probe.ts`;
    const proc = Bun.spawn([process.execPath, 'run', fixture], {
      env: { ...process.env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain('CLOSE_OK');
  }, 30000);

  test('app quit with a live engine exits cleanly (no teardown crash)', async () => {
    const fixture = `${import.meta.dir}/fixtures/app-quit-probe.ts`;
    const proc = Bun.spawn([process.execPath, 'run', fixture], {
      env: { ...process.env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(stdout).toContain('QUITTING');
    expect(exitCode).toBe(0); // a WebKit teardown crash would be a non-zero code
  }, 30000);
});

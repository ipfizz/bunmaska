import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { resolveWindowsEngineDir } from '../../../src/main/platform/windows/webkit2-ffi';

/**
 * Windows + engine only. Proves the WinCairo `session` backend end-to-end:
 * `session.defaultSession.clearStorageData()` drives the real WebKit cookie store
 * and fetch-cache removers and resolves once the engine signals completion through
 * the cooperative Win32 pump — all in pure `bun:ffi`.
 *
 * Driven in a spawned Bun subprocess: loading `WebKit2.dll` spins up the engine's
 * threads, which do not coexist with the bun:test runner host (same reason the
 * WKView IPC test spawns a fresh process). Skipped unless BUNMASKA_WEBKIT_PATH
 * points at a WinCairo engine directory.
 */
const hasEngine = currentPlatform() === 'windows' && resolveWindowsEngineDir() !== undefined;

describe.skipIf(!hasEngine)('Windows session.clearStorageData on WinCairo', () => {
  test('clears cookies and caches against the default data store', async () => {
    const fixture = `${import.meta.dir}/fixtures/session-clear-probe.ts`;
    const proc = Bun.spawn([process.execPath, 'run', fixture], {
      env: { ...process.env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain('CLEAR_OK');
  }, 40000);
});

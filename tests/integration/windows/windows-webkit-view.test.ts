import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { resolveWindowsEngineDir } from '../../../src/main/platform/windows/webkit2-ffi';

/**
 * Windows + engine only. The load-bearing WinCairo proof: a real `WKView` hosted
 * in a native Win32 window spawns the WebKit web/network processes, runs an
 * injected document-start script, and delivers its `postMessage` back to the main
 * process through Bunmaska's cooperative Win32 message pump — all in pure
 * `bun:ffi`, zero compiled native code.
 *
 * Driven in a spawned Bun subprocess: WebKit's multi-process IPC + thread
 * affinity do not coexist with the bun:test runner host (the same reason the
 * Linux engine-pinned-load test spawns a fresh process). Skipped unless
 * BUNMASKA_WEBKIT_PATH points at a WinCairo engine directory.
 */
const hasEngine = currentPlatform() === 'windows' && resolveWindowsEngineDir() !== undefined;

describe.skipIf(!hasEngine)('WindowsWebView IPC on WinCairo', () => {
  test('a renderer postMessage round-trips through a hosted WKView', async () => {
    const fixture = `${import.meta.dir}/fixtures/webkit-ipc-probe.ts`;
    const proc = Bun.spawn([process.execPath, 'run', fixture], {
      env: { ...process.env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain('IPC_OK {"ping":"pong"}');
  }, 40000);
});

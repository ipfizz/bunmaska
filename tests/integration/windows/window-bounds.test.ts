import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { resolveWindowsEngineDir } from '../../../src/main/platform/windows/webkit2-ffi';

/**
 * Windows + engine only. `setBounds` / `setPosition` move + size the real native
 * window (Win32 `SetWindowPos`) and `getBounds` reads it back (`GetWindowRect`).
 * Spawned in a subprocess like the other engine probes.
 */
const hasEngine = currentPlatform() === 'windows' && resolveWindowsEngineDir() !== undefined;

describe.skipIf(!hasEngine)('Windows BrowserWindow setBounds/setPosition', () => {
  test('round-trip through SetWindowPos/GetWindowRect', async () => {
    const fixture = `${import.meta.dir}/fixtures/window-bounds-probe.ts`;
    const proc = Bun.spawn([process.execPath, 'run', fixture], {
      env: { ...process.env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    expect(stdout).toContain('BOUNDS_OK');
    expect(stdout).toContain('boundsOk=true');
    expect(stdout).toContain('positionOk=true');
    expect(code).toBe(0);
  }, 40000);
});

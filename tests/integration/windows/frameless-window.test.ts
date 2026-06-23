import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { resolveWindowsEngineDir } from '../../../src/main/platform/windows/webkit2-ffi';

/**
 * Windows + engine only. Custom (frameless) title bars: a `frame: false` window
 * gets the built-in `window.__bunmaska.window` controls and the `--app-region`
 * drag cascade (Bunmaska's `-webkit-app-region` equivalent, since WinCairo WebKit
 * does not parse `-webkit-app-region`), and the window-op channel routes
 * renderer -> main -> native. Spawned in a subprocess like the other engine probes.
 */
const hasEngine = currentPlatform() === 'windows' && resolveWindowsEngineDir() !== undefined;

describe.skipIf(!hasEngine)('Windows frameless window + custom title bar', () => {
  test('built-in controls + --app-region drag cascade + window-op channel', async () => {
    const fixture = `${import.meta.dir}/fixtures/frameless-window-probe.ts`;
    const proc = Bun.spawn([process.execPath, 'run', fixture], {
      env: { ...process.env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    expect(stdout).toContain('FRAMELESS_OK');
    expect(stdout).toContain('"controls":true');
    expect(stdout).toContain('"barRegion":"drag"');
    expect(stdout).toContain('"btnRegion":"no-drag"');
    // Exited via the built-in close control -> the window-op channel works.
    expect(code).toBe(0);
  }, 40000);
});

import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { resolveWindowsEngineDir } from '../../../src/main/platform/windows/webkit2-ffi';

/**
 * Windows + engine only. Proves `bunmaska dev`'s live-reload end-to-end: with
 * BUNMASKA_DEV=1 a `reload` command written on the child's stdin reloads the open
 * window's page in place (a second navigation), with no process restart — the
 * supervisor sends exactly this for a renderer-only change.
 *
 * Skipped unless BUNMASKA_WEBKIT_PATH points at a WinCairo engine directory.
 */
const hasEngine = currentPlatform() === 'windows' && resolveWindowsEngineDir() !== undefined;

describe.skipIf(!hasEngine)('Windows dev live-reload', () => {
  test('a reload command on stdin reloads the page in place', async () => {
    const fixture = `${import.meta.dir}/fixtures/dev-reload-probe.ts`;
    const proc = Bun.spawn([process.execPath, 'run', fixture], {
      env: { ...process.env, BUNMASKA_DEV: '1' },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let out = '';
    let sentReload = false;
    const deadline = Date.now() + 35000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      out += decoder.decode(value);
      if (!sentReload && out.includes('DEV_RELOAD_READY')) {
        sentReload = true;
        proc.stdin.write('reload\n');
        proc.stdin.flush();
      }
      if (out.includes('DEV_RELOAD_OK') || out.includes('DEV_RELOAD_FAIL')) {
        break;
      }
    }
    await proc.exited;
    expect(out).toContain('DEV_RELOAD_READY');
    expect(out).toContain('DEV_RELOAD_OK');
  }, 45000);
});

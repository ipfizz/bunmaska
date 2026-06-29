import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { resolveWindowsEngineDir } from '../../../src/main/platform/windows/webkit2-ffi';

/**
 * Windows + engine only. Proves the preload-bundling fix end-to-end: a preload
 * that uses `import` still exposes `window.api` on a real WinCairo WebView,
 * because `loadPreloadScript` bundles it into a classic IIFE before injection
 * (an un-bundled `import` would throw and silently break the bridge).
 *
 * Driven in a spawned Bun subprocess (so the preload is bundled under the Bun
 * CLI, matching `bunmaska dev`). Skipped unless BUNMASKA_WEBKIT_PATH is set.
 */
const hasEngine = currentPlatform() === 'windows' && resolveWindowsEngineDir() !== undefined;

describe.skipIf(!hasEngine)('Windows preload bundling', () => {
  test('a preload that uses import still exposes window.api', async () => {
    const fixture = `${import.meta.dir}/fixtures/preload-import-probe.ts`;
    const proc = Bun.spawn([process.execPath, 'run', fixture], {
      env: { ...process.env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    expect(stdout).toContain('PRELOAD_IMPORT_OK "hi bun from helper"');
    expect(code).toBe(0);
  }, 40000);
});

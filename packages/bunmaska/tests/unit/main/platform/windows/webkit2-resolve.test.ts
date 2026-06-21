import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { ResolveDeps } from '../../../../../src/main/engine/resolve';
import { resolveWindowsEngineDir } from '../../../../../src/main/platform/windows/webkit2-ffi';

/**
 * `resolveWindowsEngineDir` decides which WinCairo WebKit directory THIS Windows
 * process loads. Windows ships no system WebKit, so — unlike Linux, where the
 * resolver can fall back to the OS WebKitGTK — every "system" outcome here means
 * "no engine" (`undefined`). It delegates to the cross-platform `resolveEngineWith`,
 * so the precedence (BUNMASKA_WEBKIT_PATH > BUNMASKA_WEBKIT_ID > baked engine.id)
 * and the store layout (`<root>/<id>/lib`) are inherited; these tests pin down the
 * Windows-specific mapping of that resolution to a directory.
 */
const ID = 'webkit-2-2.52.4-bunmaska1-windows-x64';
const ROOT = 'C:\\store\\webkit';

/** Inject deterministic seams (no ambient env / fs) into the resolver. */
const dir = (deps: ResolveDeps): string | undefined =>
  resolveWindowsEngineDir({
    enginesRoot: ROOT,
    exists: () => true,
    readBakedId: () => null,
    ...deps,
  });

describe('resolveWindowsEngineDir', () => {
  test('BUNMASKA_WEBKIT_PATH is used verbatim (the explicit-dir pin)', () => {
    expect(dir({ env: { BUNMASKA_WEBKIT_PATH: 'D:\\engines\\webkit' } })).toBe(
      'D:\\engines\\webkit',
    );
  });

  test('a baked engine.id with an installed marker resolves to <root>/<id>/lib', () => {
    expect(dir({ env: {}, readBakedId: () => ID })).toBe(join(ROOT, ID, 'lib'));
  });

  test('BUNMASKA_WEBKIT_ID overrides the baked id', () => {
    const other = 'webkit-2-2.46.0-bunmaska1-windows-x64';
    expect(dir({ env: { BUNMASKA_WEBKIT_ID: other }, readBakedId: () => ID })).toBe(
      join(ROOT, other, 'lib'),
    );
  });

  test('no pin anywhere -> undefined (no system WebKit to fall back to)', () => {
    expect(dir({ env: {}, readBakedId: () => null })).toBeUndefined();
  });

  test('the system sentinel -> undefined', () => {
    expect(dir({ env: { BUNMASKA_WEBKIT_ID: 'system' } })).toBeUndefined();
  });

  test('a pinned engine whose marker is missing -> undefined (not installed)', () => {
    expect(dir({ env: {}, readBakedId: () => ID, exists: () => false })).toBeUndefined();
  });

  test('a malformed pin -> undefined', () => {
    expect(dir({ env: { BUNMASKA_WEBKIT_ID: 'not-an-engine-id' } })).toBeUndefined();
  });
});

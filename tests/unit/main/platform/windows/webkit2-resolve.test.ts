import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { ResolveDeps } from '../../../../../src/main/engine/resolve';
import {
  bundledEngineDir,
  resolveWindowsEngineDir,
} from '../../../../../src/main/platform/windows/webkit2-ffi';

// Windows ships no system WebKit, so every "system" resolution means "no engine" (`undefined`).
const ID = 'webkit-2-2.52.4-bunmaska1-windows-x64';
const ROOT = 'C:\\store\\webkit';
const APP_DIR = 'C:\\Program Files\\My App';

/** Inject deterministic seams (no ambient env / fs); only a bundled WebKit2.dll is absent. */
const dir = (deps: ResolveDeps & { readonly execPath?: string }): string | undefined =>
  resolveWindowsEngineDir({
    enginesRoot: ROOT,
    execPath: join(APP_DIR, 'My App.exe'),
    exists: (path) => !path.endsWith('WebKit2.dll'),
    readBakedId: () => null,
    host: { os: 'windows', arch: 'x64' },
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

  test('no pin -> the engine bundled next to the executable', () => {
    expect(dir({ env: {}, exists: () => true })).toBe(join(APP_DIR, 'webkit'));
  });

  test('a pin wins over a bundled engine', () => {
    expect(dir({ env: {}, readBakedId: () => ID, exists: () => true })).toBe(join(ROOT, ID, 'lib'));
  });
});

describe('bundledEngineDir', () => {
  const exe = join('C:\\Program Files\\My App', 'My App.exe');
  const webkit = join('C:\\Program Files\\My App', 'webkit');

  test('resolves <exeDir>/webkit when WebKit2.dll is bundled there', () => {
    expect(bundledEngineDir(exe, () => true)).toBe(webkit);
  });

  test('is undefined when nothing is bundled next to the exe', () => {
    expect(bundledEngineDir(exe, () => false)).toBeUndefined();
  });

  test('checks specifically for webkit/WebKit2.dll', () => {
    const marker = join(webkit, 'WebKit2.dll');
    expect(bundledEngineDir(exe, (p) => p === marker)).toBe(webkit);
    expect(bundledEngineDir(exe, (p) => p === join(webkit, 'other.dll'))).toBeUndefined();
  });
});

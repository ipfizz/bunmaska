import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { EngineResolution } from '../../../../../src/main/engine/resolve';
import { linuxLibPath } from '../../../../../src/main/platform/linux/glib-ffi';

const SONAME = 'libglib-2.0.so.0';
const LIB_DIR = join('/store', 'engine', 'lib');
const BUNDLED = join(LIB_DIR, SONAME);
const CWD = join('/home', 'user', 'project');
const pinned: EngineResolution = { mode: 'pinned', libDir: LIB_DIR, warnings: [] };
const system: EngineResolution = { mode: 'system', warnings: [] };

describe('linuxLibPath', () => {
  test('a pinned engine that bundles the library loads the bundled copy', () => {
    expect(linuxLibPath(pinned, SONAME, (path) => path === BUNDLED)).toBe(BUNDLED);
  });

  test('a pinned engine without the library falls back to the system soname', () => {
    expect(linuxLibPath(pinned, SONAME, () => false)).toBe(SONAME);
  });

  test('system mode loads the system soname', () => {
    expect(linuxLibPath(system, SONAME, (path) => path === BUNDLED)).toBe(SONAME);
  });

  test('a bare soname is refused when a file of that name sits in the working directory', () => {
    const planted = (path: string) => path === join(CWD, SONAME);
    expect(() => linuxLibPath(system, SONAME, planted, CWD)).toThrow(/working directory/);
  });
});

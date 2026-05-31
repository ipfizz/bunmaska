import { FFIType } from 'bun:ffi';
import { describe, expect, it } from 'bun:test';
import { GIO_FFI_SYMBOLS, loadGioFFI } from '../../../../../src/main/platform/linux/gio-ffi';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';

describe('loadGioFFI', () => {
  it('throws UnsupportedPlatformError on non-Linux platforms', () => {
    if (currentPlatform() === 'linux') {
      return;
    }
    expect(() => loadGioFFI()).toThrow(UnsupportedPlatformError);
  });
});

describe('GIO_FFI_SYMBOLS (shape-only ABI assertions)', () => {
  it('declares g_app_info_launch_default_for_uri as [cstring, ptr, ptr] -> i32 (gboolean)', () => {
    const sym = GIO_FFI_SYMBOLS.g_app_info_launch_default_for_uri;
    expect(sym.args).toEqual([FFIType.cstring, FFIType.pointer, FFIType.pointer]);
    expect(sym.args.length).toBe(3);
    expect(sym.returns).toBe(FFIType.i32);
  });
});

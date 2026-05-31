import { FFIType } from 'bun:ffi';
import { describe, expect, it } from 'bun:test';
import { GDK_FFI_SYMBOLS, loadGdkFFI } from '../../../../../src/main/platform/linux/gdk-ffi';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';

describe('loadGdkFFI', () => {
  it('throws UnsupportedPlatformError on non-Linux platforms', () => {
    if (currentPlatform() === 'linux') {
      return;
    }
    expect(() => loadGdkFFI()).toThrow(UnsupportedPlatformError);
  });
});

describe('GDK_FFI_SYMBOLS (shape-only ABI assertions)', () => {
  it('declares gdk_display_get_default as [] -> pointer (nullable GdkDisplay*)', () => {
    const sym = GDK_FFI_SYMBOLS.gdk_display_get_default;
    expect(sym.args).toEqual([]);
    expect(sym.returns).toBe(FFIType.pointer);
  });

  it('declares gdk_display_beep as [ptr] -> void', () => {
    const sym = GDK_FFI_SYMBOLS.gdk_display_beep;
    expect(sym.args).toEqual([FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.void);
  });
});

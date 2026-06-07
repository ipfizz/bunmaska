import { FFIType } from 'bun:ffi';
import { describe, expect, it } from 'bun:test';
import {
  G_CONNECT_DEFAULT,
  GOBJECT_FFI_SYMBOLS,
  loadGObjectFFI,
} from '../../../../../src/main/platform/linux/gobject-ffi';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';

describe('loadGObjectFFI', () => {
  it('throws UnsupportedPlatformError on non-Linux platforms', () => {
    if (currentPlatform() === 'linux') {
      return;
    }
    expect(() => loadGObjectFFI()).toThrow(UnsupportedPlatformError);
  });
});

describe('GOBJECT_FFI_SYMBOLS (shape-only ABI assertions)', () => {
  it('declares g_signal_connect_data as [ptr, cstring, ptr, ptr, ptr, u32] -> u64', () => {
    const sym = GOBJECT_FFI_SYMBOLS.g_signal_connect_data;
    expect(sym.args).toEqual([
      FFIType.pointer,
      FFIType.cstring,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.u32,
    ]);
    expect(sym.returns).toBe(FFIType.u64);
  });

  it('declares g_signal_handler_disconnect as [ptr, u64] -> void', () => {
    expect(GOBJECT_FFI_SYMBOLS.g_signal_handler_disconnect.args).toEqual([
      FFIType.pointer,
      FFIType.u64,
    ]);
    expect(GOBJECT_FFI_SYMBOLS.g_signal_handler_disconnect.returns).toBe(FFIType.void);
  });

  it('declares g_object_ref -> pointer and g_object_unref -> void', () => {
    expect(GOBJECT_FFI_SYMBOLS.g_object_ref.args).toEqual([FFIType.pointer]);
    expect(GOBJECT_FFI_SYMBOLS.g_object_ref.returns).toBe(FFIType.pointer);
    expect(GOBJECT_FFI_SYMBOLS.g_object_unref.args).toEqual([FFIType.pointer]);
    expect(GOBJECT_FFI_SYMBOLS.g_object_unref.returns).toBe(FFIType.void);
  });

  it('declares g_object_new with the fixed 4-arity [u64, cstring, ptr, ptr] -> ptr', () => {
    const sym = GOBJECT_FFI_SYMBOLS.g_object_new;
    expect(sym.args).toEqual([FFIType.u64, FFIType.cstring, FFIType.pointer, FFIType.pointer]);
    expect(sym.args.length).toBe(4);
    expect(sym.returns).toBe(FFIType.pointer);
  });

  it('declares g_object_get as [ptr, cstring, ptr (out), ptr (null)] -> void', () => {
    const sym = GOBJECT_FFI_SYMBOLS.g_object_get;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.cstring, FFIType.pointer, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('exposes G_CONNECT_DEFAULT === 0', () => {
    expect(G_CONNECT_DEFAULT).toBe(0);
  });
});

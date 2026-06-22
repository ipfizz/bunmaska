import { FFIType } from 'bun:ffi';
import { describe, expect, it } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import {
  GDK_PIXBUF_FFI_SYMBOLS,
  loadGdkPixbufFFI,
} from '../../../../../src/main/platform/linux/gdk-pixbuf-ffi';

describe('loadGdkPixbufFFI', () => {
  it('throws UnsupportedPlatformError on non-Linux platforms', () => {
    if (currentPlatform() === 'linux') {
      return;
    }
    expect(() => loadGdkPixbufFFI()).toThrow(UnsupportedPlatformError);
  });
});

describe('GDK_PIXBUF_FFI_SYMBOLS (shape-only ABI assertions)', () => {
  it('declares gdk_pixbuf_new_from_file as [cstring (path), ptr (GError**)] -> ptr', () => {
    const sym = GDK_PIXBUF_FFI_SYMBOLS.gdk_pixbuf_new_from_file;
    expect(sym.args).toEqual([FFIType.cstring, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.pointer);
  });

  it('declares gdk_pixbuf_new_from_stream as [ptr (stream), ptr (cancellable), ptr (error)] -> ptr', () => {
    const sym = GDK_PIXBUF_FFI_SYMBOLS.gdk_pixbuf_new_from_stream;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.pointer, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.pointer);
  });

  it('declares gdk_pixbuf_get_width as [ptr (pixbuf)] -> i32', () => {
    const sym = GDK_PIXBUF_FFI_SYMBOLS.gdk_pixbuf_get_width;
    expect(sym.args).toEqual([FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.i32);
  });

  it('declares gdk_pixbuf_get_height as [ptr (pixbuf)] -> i32', () => {
    const sym = GDK_PIXBUF_FFI_SYMBOLS.gdk_pixbuf_get_height;
    expect(sym.args).toEqual([FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.i32);
  });

  it('declares gdk_pixbuf_save_to_bufferv as [ptr, ptr (buffer**), ptr (size*), cstring (type), ptr (keys), ptr (vals), ptr (error)] -> i32', () => {
    const sym = GDK_PIXBUF_FFI_SYMBOLS.gdk_pixbuf_save_to_bufferv;
    expect(sym.args).toEqual([
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.cstring,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
    ]);
    expect(sym.returns).toBe(FFIType.i32);
  });
});

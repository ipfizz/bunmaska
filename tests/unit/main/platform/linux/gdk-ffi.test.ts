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

  it('declares gdk_display_get_clipboard as [ptr] -> pointer (GdkClipboard*)', () => {
    const sym = GDK_FFI_SYMBOLS.gdk_display_get_clipboard;
    expect(sym.args).toEqual([FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.pointer);
  });

  it('declares gdk_clipboard_read_text_async as [ptr, ptr, ptr (cb), ptr] -> void', () => {
    const sym = GDK_FFI_SYMBOLS.gdk_clipboard_read_text_async;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.pointer, FFIType.pointer, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares gdk_clipboard_read_text_finish as [ptr, ptr, ptr] -> pointer (char*)', () => {
    const sym = GDK_FFI_SYMBOLS.gdk_clipboard_read_text_finish;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.pointer, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.pointer);
  });

  it('declares gdk_clipboard_set_content as [ptr, ptr] -> i32 (gboolean)', () => {
    const sym = GDK_FFI_SYMBOLS.gdk_clipboard_set_content;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.i32);
  });

  it('declares gdk_content_provider_new_for_bytes as [cstring, ptr] -> pointer', () => {
    const sym = GDK_FFI_SYMBOLS.gdk_content_provider_new_for_bytes;
    expect(sym.args).toEqual([FFIType.cstring, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.pointer);
  });
});

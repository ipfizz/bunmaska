import { FFIType } from 'bun:ffi';
import { describe, expect, it } from 'bun:test';
import { GTK_FFI_SYMBOLS, loadGtkFFI } from '../../../../../src/main/platform/linux/gtk-ffi';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';

describe('loadGtkFFI', () => {
  it('throws UnsupportedPlatformError on non-Linux platforms', () => {
    if (currentPlatform() === 'linux') {
      return;
    }
    expect(() => loadGtkFFI()).toThrow(UnsupportedPlatformError);
  });
});

describe('GTK_FFI_SYMBOLS (shape-only ABI assertions)', () => {
  it('embeds a WebKitWebView as a window child via set_child([ptr, ptr] -> void)', () => {
    expect(GTK_FFI_SYMBOLS.gtk_window_set_child.args).toEqual([FFIType.pointer, FFIType.pointer]);
    expect(GTK_FFI_SYMBOLS.gtk_window_set_child.returns).toBe(FFIType.void);
  });

  it('declares set_visible second arg as i32 (gboolean), not bool', () => {
    expect(GTK_FFI_SYMBOLS.gtk_widget_set_visible.args).toEqual([FFIType.pointer, FFIType.i32]);
    expect(GTK_FFI_SYMBOLS.gtk_widget_set_visible.returns).toBe(FFIType.void);
  });

  it('closes a window via destroy([ptr] -> void)', () => {
    expect(GTK_FFI_SYMBOLS.gtk_window_destroy.args).toEqual([FFIType.pointer]);
    expect(GTK_FFI_SYMBOLS.gtk_window_destroy.returns).toBe(FFIType.void);
  });

  it('declares minimize/unminimize/maximize/unmaximize as [ptr] -> void', () => {
    for (const name of [
      'gtk_window_minimize',
      'gtk_window_unminimize',
      'gtk_window_maximize',
      'gtk_window_unmaximize',
    ] as const) {
      expect(GTK_FFI_SYMBOLS[name].args).toEqual([FFIType.pointer]);
      expect(GTK_FFI_SYMBOLS[name].returns).toBe(FFIType.void);
    }
  });

  it('returns i32 (gboolean) from is_maximized', () => {
    expect(GTK_FFI_SYMBOLS.gtk_window_is_maximized.args).toEqual([FFIType.pointer]);
    expect(GTK_FFI_SYMBOLS.gtk_window_is_maximized.returns).toBe(FFIType.i32);
  });

  it('reads allocated size via get_width/get_height([ptr] -> i32)', () => {
    expect(GTK_FFI_SYMBOLS.gtk_widget_get_width.args).toEqual([FFIType.pointer]);
    expect(GTK_FFI_SYMBOLS.gtk_widget_get_width.returns).toBe(FFIType.i32);
    expect(GTK_FFI_SYMBOLS.gtk_widget_get_height.args).toEqual([FFIType.pointer]);
    expect(GTK_FFI_SYMBOLS.gtk_widget_get_height.returns).toBe(FFIType.i32);
  });

  it('reads the title as a nullable pointer (not cstring) so 0 can be guarded', () => {
    expect(GTK_FFI_SYMBOLS.gtk_window_get_title.args).toEqual([FFIType.pointer]);
    expect(GTK_FFI_SYMBOLS.gtk_window_get_title.returns).toBe(FFIType.pointer);
  });
});

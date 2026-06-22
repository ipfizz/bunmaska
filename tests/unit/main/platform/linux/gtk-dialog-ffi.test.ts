import { FFIType } from 'bun:ffi';
import { describe, expect, it } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import {
  GTK_DIALOG_FFI_SYMBOLS,
  GTK_DIALOG_GOBJECT_FFI_SYMBOLS,
  loadGtkDialogFFI,
  loadGtkDialogGObjectFFI,
} from '../../../../../src/main/platform/linux/gtk-dialog-ffi';

describe('loadGtkDialogFFI', () => {
  it('throws UnsupportedPlatformError on non-Linux platforms', () => {
    if (currentPlatform() === 'linux') {
      return;
    }
    expect(() => loadGtkDialogFFI()).toThrow(UnsupportedPlatformError);
  });
});

describe('loadGtkDialogGObjectFFI', () => {
  it('throws UnsupportedPlatformError on non-Linux platforms', () => {
    if (currentPlatform() === 'linux') {
      return;
    }
    expect(() => loadGtkDialogGObjectFFI()).toThrow(UnsupportedPlatformError);
  });
});

describe('GTK_DIALOG_FFI_SYMBOLS (shape-only ABI assertions)', () => {
  it('declares gtk_alert_dialog_get_type as [] -> u64 (GType)', () => {
    const sym = GTK_DIALOG_FFI_SYMBOLS.gtk_alert_dialog_get_type;
    expect(sym.args).toEqual([]);
    expect(sym.returns).toBe(FFIType.u64);
  });

  it('declares gtk_alert_dialog_set_message as [ptr, cstring] -> void', () => {
    const sym = GTK_DIALOG_FFI_SYMBOLS.gtk_alert_dialog_set_message;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.cstring]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares gtk_alert_dialog_set_detail as [ptr, cstring] -> void', () => {
    const sym = GTK_DIALOG_FFI_SYMBOLS.gtk_alert_dialog_set_detail;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.cstring]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares gtk_alert_dialog_set_modal as [ptr, i32 (gboolean)] -> void', () => {
    const sym = GTK_DIALOG_FFI_SYMBOLS.gtk_alert_dialog_set_modal;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.i32]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares gtk_alert_dialog_set_buttons as [ptr, ptr (const char* const*)] -> void', () => {
    const sym = GTK_DIALOG_FFI_SYMBOLS.gtk_alert_dialog_set_buttons;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares gtk_alert_dialog_choose as [ptr, ptr, ptr, ptr (cb), ptr] -> void', () => {
    const sym = GTK_DIALOG_FFI_SYMBOLS.gtk_alert_dialog_choose;
    expect(sym.args).toEqual([
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
    ]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares gtk_alert_dialog_choose_finish as [ptr, ptr, ptr] -> i32 (button index)', () => {
    const sym = GTK_DIALOG_FFI_SYMBOLS.gtk_alert_dialog_choose_finish;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.pointer, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.i32);
  });

  it('declares gtk_file_dialog_new as [] -> ptr', () => {
    const sym = GTK_DIALOG_FFI_SYMBOLS.gtk_file_dialog_new;
    expect(sym.args).toEqual([]);
    expect(sym.returns).toBe(FFIType.pointer);
  });

  it('declares gtk_file_dialog_set_title as [ptr, cstring] -> void', () => {
    const sym = GTK_DIALOG_FFI_SYMBOLS.gtk_file_dialog_set_title;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.cstring]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares gtk_file_dialog_set_modal as [ptr, i32 (gboolean)] -> void', () => {
    const sym = GTK_DIALOG_FFI_SYMBOLS.gtk_file_dialog_set_modal;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.i32]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares gtk_file_dialog_set_initial_name as [ptr, cstring] -> void', () => {
    const sym = GTK_DIALOG_FFI_SYMBOLS.gtk_file_dialog_set_initial_name;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.cstring]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares gtk_file_dialog_open as [ptr, ptr, ptr, ptr (cb), ptr] -> void', () => {
    const sym = GTK_DIALOG_FFI_SYMBOLS.gtk_file_dialog_open;
    expect(sym.args).toEqual([
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
    ]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares gtk_file_dialog_open_finish as [ptr, ptr, ptr] -> ptr (GFile*)', () => {
    const sym = GTK_DIALOG_FFI_SYMBOLS.gtk_file_dialog_open_finish;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.pointer, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.pointer);
  });

  it('declares gtk_file_dialog_save as [ptr, ptr, ptr, ptr (cb), ptr] -> void', () => {
    const sym = GTK_DIALOG_FFI_SYMBOLS.gtk_file_dialog_save;
    expect(sym.args).toEqual([
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
    ]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares gtk_file_dialog_save_finish as [ptr, ptr, ptr] -> ptr (GFile*)', () => {
    const sym = GTK_DIALOG_FFI_SYMBOLS.gtk_file_dialog_save_finish;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.pointer, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.pointer);
  });
});

describe('GTK_DIALOG_GOBJECT_FFI_SYMBOLS (shape-only ABI assertions)', () => {
  it('declares the 2-arity g_object_new(type, NULL) as [u64, ptr] -> ptr', () => {
    const sym = GTK_DIALOG_GOBJECT_FFI_SYMBOLS.g_object_new;
    expect(sym.args).toEqual([FFIType.u64, FFIType.pointer]);
    expect(sym.args.length).toBe(2);
    expect(sym.returns).toBe(FFIType.pointer);
  });
});

import { FFIType } from 'bun:ffi';
import { describe, expect, it } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import {
  GMENU_FFI_SYMBOLS,
  GTK_MENU_FFI_SYMBOLS,
  loadGMenuFFI,
  loadGtkMenuFFI,
} from '../../../../../src/main/platform/linux/gtk-menu-ffi';

describe('loadGMenuFFI', () => {
  it('throws UnsupportedPlatformError on non-Linux platforms', () => {
    if (currentPlatform() === 'linux') {
      return;
    }
    expect(() => loadGMenuFFI()).toThrow(UnsupportedPlatformError);
  });
});

describe('loadGtkMenuFFI', () => {
  it('throws UnsupportedPlatformError on non-Linux platforms', () => {
    if (currentPlatform() === 'linux') {
      return;
    }
    expect(() => loadGtkMenuFFI()).toThrow(UnsupportedPlatformError);
  });
});

describe('GMENU_FFI_SYMBOLS (shape-only ABI assertions)', () => {
  it('declares g_menu_new as [] -> ptr', () => {
    const sym = GMENU_FFI_SYMBOLS.g_menu_new;
    expect(sym.args).toEqual([]);
    expect(sym.returns).toBe(FFIType.pointer);
  });

  it('declares g_menu_append as [ptr, cstring, cstring] -> void', () => {
    const sym = GMENU_FFI_SYMBOLS.g_menu_append;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.cstring, FFIType.cstring]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares g_menu_append_submenu as [ptr, cstring, ptr] -> void', () => {
    const sym = GMENU_FFI_SYMBOLS.g_menu_append_submenu;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.cstring, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares g_menu_append_section as [ptr, cstring, ptr] -> void', () => {
    const sym = GMENU_FFI_SYMBOLS.g_menu_append_section;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.cstring, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares g_simple_action_group_new as [] -> ptr', () => {
    const sym = GMENU_FFI_SYMBOLS.g_simple_action_group_new;
    expect(sym.args).toEqual([]);
    expect(sym.returns).toBe(FFIType.pointer);
  });

  it('declares g_simple_action_new as [cstring, ptr (param GVariantType*)] -> ptr', () => {
    const sym = GMENU_FFI_SYMBOLS.g_simple_action_new;
    expect(sym.args).toEqual([FFIType.cstring, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.pointer);
  });

  it('declares g_simple_action_set_enabled as [ptr, i32 (gboolean)] -> void', () => {
    const sym = GMENU_FFI_SYMBOLS.g_simple_action_set_enabled;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.i32]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares g_action_map_add_action as [ptr, ptr] -> void', () => {
    const sym = GMENU_FFI_SYMBOLS.g_action_map_add_action;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares g_action_group_activate_action as [ptr, cstring, ptr (param GVariant*)] -> void', () => {
    const sym = GMENU_FFI_SYMBOLS.g_action_group_activate_action;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.cstring, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.void);
  });
});

describe('GTK_MENU_FFI_SYMBOLS (shape-only ABI assertions)', () => {
  it('declares gtk_box_new as [i32 (orientation), i32 (spacing)] -> ptr', () => {
    const sym = GTK_MENU_FFI_SYMBOLS.gtk_box_new;
    expect(sym.args).toEqual([FFIType.i32, FFIType.i32]);
    expect(sym.returns).toBe(FFIType.pointer);
  });

  it('declares gtk_box_append as [ptr, ptr] -> void', () => {
    const sym = GTK_MENU_FFI_SYMBOLS.gtk_box_append;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares gtk_popover_menu_bar_new_from_model as [ptr (GMenuModel*)] -> ptr', () => {
    const sym = GTK_MENU_FFI_SYMBOLS.gtk_popover_menu_bar_new_from_model;
    expect(sym.args).toEqual([FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.pointer);
  });

  it('declares gtk_widget_insert_action_group as [ptr, cstring, ptr] -> void', () => {
    const sym = GTK_MENU_FFI_SYMBOLS.gtk_widget_insert_action_group;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.cstring, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.void);
  });
});

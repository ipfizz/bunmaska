import { describe, expect, it } from 'bun:test';
import {
  DBUS_GET_PROPERTY_CB_DEF,
  DBUS_METHOD_CALL_CB_DEF,
  DBUS_SET_PROPERTY_CB_DEF,
  VTABLE_SLOTS,
} from '../../../../../src/main/platform/linux/gdbus-ffi';
import { rgbaToArgb32Network, SNI_XML } from '../../../../../src/main/platform/linux/sni-tray';

/**
 * Pure unit tests for the SNI tray — the FFI-free core: the RGBA→ARGB32-network pixel swap
 * (the riskiest blind piece, exercised exhaustively here), the vtable/callback ABI shapes,
 * and the embedded introspection XML. No `dlopen`, runs on any host.
 */

describe('rgbaToArgb32Network', () => {
  it('swaps a single RGBA pixel to A,R,G,B network order', () => {
    const out = rgbaToArgb32Network(new Uint8Array([10, 20, 30, 40]), 1, 1, 4, 4);
    expect(Array.from(out)).toEqual([40, 10, 20, 30]);
  });

  it('synthesizes A=0xFF for a 3-channel (no-alpha) source', () => {
    const out = rgbaToArgb32Network(new Uint8Array([10, 20, 30]), 1, 1, 3, 3);
    expect(Array.from(out)).toEqual([0xff, 10, 20, 30]);
  });

  it('strips row padding using rowstride (not width*channels)', () => {
    // 2×1 RGBA with a 4-byte row pad (rowstride 12 > 2*4=8).
    const row = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0]);
    const out = rgbaToArgb32Network(row, 2, 1, 12, 4);
    expect(Array.from(out)).toEqual([4, 1, 2, 3, 8, 5, 6, 7]); // [A,R,G,B] per pixel, pad ignored
  });

  it('reads each row at its rowstride offset for height > 1', () => {
    // 1×2 RGBA, rowstride 8 (4 data + 4 pad per row).
    const px = new Uint8Array([10, 11, 12, 13, 0, 0, 0, 0, 20, 21, 22, 23, 0, 0, 0, 0]);
    const out = rgbaToArgb32Network(px, 1, 2, 8, 4);
    expect(Array.from(out)).toEqual([13, 10, 11, 12, 23, 20, 21, 22]);
  });
});

describe('SNI vtable + callback ABI shapes', () => {
  it('the vtable has 11 slots (3 fn-ptrs + gpointer padding[8])', () => {
    expect(VTABLE_SLOTS).toBe(11);
  });

  it('method_call is 8 ptr -> void; get_property is 7 ptr -> ptr; set_property is 8 ptr -> i32', () => {
    expect(DBUS_METHOD_CALL_CB_DEF.args).toHaveLength(8);
    expect(DBUS_METHOD_CALL_CB_DEF.returns).toBe('void');
    expect(DBUS_GET_PROPERTY_CB_DEF.args).toHaveLength(7);
    expect(DBUS_GET_PROPERTY_CB_DEF.returns).toBe('ptr');
    expect(DBUS_SET_PROPERTY_CB_DEF.args).toHaveLength(8);
    expect(DBUS_SET_PROPERTY_CB_DEF.returns).toBe('i32');
  });
});

describe('SNI introspection XML', () => {
  it('declares the StatusNotifierItem interface with the served properties + Activate', () => {
    expect(SNI_XML).toContain('name="org.kde.StatusNotifierItem"');
    for (const prop of ['Category', 'Id', 'Title', 'Status', 'IconPixmap', 'ToolTip', 'Menu']) {
      expect(SNI_XML).toContain(`name="${prop}"`);
    }
    expect(SNI_XML).toContain('name="Activate"');
    expect(SNI_XML).toContain('name="NewIcon"');
  });
});

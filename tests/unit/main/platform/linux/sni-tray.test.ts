import { describe, expect, test } from 'bun:test';
import { VTABLE_SLOTS } from '../../../../../src/main/platform/linux/gdbus-ffi';
import { rgbaToArgb32Network } from '../../../../../src/main/platform/linux/sni-tray';

describe('rgbaToArgb32Network', () => {
  test('swaps a single RGBA pixel to A,R,G,B network order', () => {
    const out = rgbaToArgb32Network(new Uint8Array([10, 20, 30, 40]), 1, 1, 4, 4);
    expect(Array.from(out)).toEqual([40, 10, 20, 30]);
  });

  test('synthesizes A=0xFF for a 3-channel (no-alpha) source', () => {
    const out = rgbaToArgb32Network(new Uint8Array([10, 20, 30]), 1, 1, 3, 3);
    expect(Array.from(out)).toEqual([0xff, 10, 20, 30]);
  });

  test('strips row padding using rowstride (not width*channels)', () => {
    // 2×1 RGBA with a 4-byte row pad (rowstride 12 > 2*4=8).
    const row = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0]);
    const out = rgbaToArgb32Network(row, 2, 1, 12, 4);
    expect(Array.from(out)).toEqual([4, 1, 2, 3, 8, 5, 6, 7]); // [A,R,G,B] per pixel, pad ignored
  });

  test('reads each row at its rowstride offset for height > 1', () => {
    // 1×2 RGBA, rowstride 8 (4 data + 4 pad per row).
    const px = new Uint8Array([10, 11, 12, 13, 0, 0, 0, 0, 20, 21, 22, 23, 0, 0, 0, 0]);
    const out = rgbaToArgb32Network(px, 1, 2, 8, 4);
    expect(Array.from(out)).toEqual([13, 10, 11, 12, 23, 20, 21, 22]);
  });
});

describe('GDBusInterfaceVTable', () => {
  test('spans the 3 fn-ptrs plus the gpointer padding[8] GDBus copies with the vtable', () => {
    expect(VTABLE_SLOTS).toBe(11);
  });
});

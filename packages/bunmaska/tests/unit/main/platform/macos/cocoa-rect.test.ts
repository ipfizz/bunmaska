import { describe, expect, test } from 'bun:test';
import { BunmaskaError } from '../../../../../src/common/errors';
import {
  CG_RECT_SIZE,
  type CGRect,
  packCGRect,
  unpackCGRect,
} from '../../../../../src/main/platform/macos/cocoa-rect';

describe('CG_RECT_SIZE', () => {
  test('is 32 bytes (4 × f64)', () => {
    expect(CG_RECT_SIZE).toBe(32);
  });
});

describe('packCGRect', () => {
  test('returns an ArrayBuffer of CG_RECT_SIZE', () => {
    const buf = packCGRect({ x: 0, y: 0, width: 0, height: 0 });
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(CG_RECT_SIZE);
  });

  test('lays out fields as [x, y, width, height] in little-endian f64', () => {
    const buf = packCGRect({ x: 1, y: 2, width: 3, height: 4 });
    const view = new DataView(buf);
    expect(view.getFloat64(0, true)).toBe(1);
    expect(view.getFloat64(8, true)).toBe(2);
    expect(view.getFloat64(16, true)).toBe(3);
    expect(view.getFloat64(24, true)).toBe(4);
  });

  test('preserves fractional values', () => {
    const r: CGRect = { x: 0.5, y: 1.25, width: 100.75, height: 200.125 };
    const view = new DataView(packCGRect(r));
    expect(view.getFloat64(0, true)).toBe(0.5);
    expect(view.getFloat64(8, true)).toBe(1.25);
    expect(view.getFloat64(16, true)).toBe(100.75);
    expect(view.getFloat64(24, true)).toBe(200.125);
  });

  test('preserves negative coordinates (multi-monitor case)', () => {
    const view = new DataView(packCGRect({ x: -100, y: -50, width: 800, height: 600 }));
    expect(view.getFloat64(0, true)).toBe(-100);
    expect(view.getFloat64(8, true)).toBe(-50);
  });

  test('preserves large values within f64 range', () => {
    const big = 1e15;
    const view = new DataView(packCGRect({ x: big, y: big, width: big, height: big }));
    expect(view.getFloat64(0, true)).toBe(big);
    expect(view.getFloat64(24, true)).toBe(big);
  });
});

describe('unpackCGRect', () => {
  test('reads back a packed buffer correctly', () => {
    const r: CGRect = { x: 10, y: 20, width: 800, height: 600 };
    expect(unpackCGRect(packCGRect(r))).toEqual(r);
  });

  test('throws BunmaskaError when buffer is smaller than CG_RECT_SIZE', () => {
    const small = new ArrayBuffer(16);
    expect(() => unpackCGRect(small)).toThrow(BunmaskaError);
    expect(() => unpackCGRect(small)).toThrow(/CGRect buffer must be at least 32 bytes/);
  });

  test('accepts a buffer larger than CG_RECT_SIZE and reads only the first 32 bytes', () => {
    const big = new ArrayBuffer(64);
    const view = new DataView(big);
    view.setFloat64(0, 7, true);
    view.setFloat64(8, 8, true);
    view.setFloat64(16, 9, true);
    view.setFloat64(24, 10, true);
    expect(unpackCGRect(big)).toEqual({ x: 7, y: 8, width: 9, height: 10 });
  });
});

describe('pack/unpack round-trip', () => {
  const cases: ReadonlyArray<CGRect> = [
    { x: 0, y: 0, width: 0, height: 0 },
    { x: 1, y: 1, width: 1, height: 1 },
    { x: -1, y: -1, width: 1, height: 1 },
    { x: 100, y: 200, width: 1920, height: 1080 },
    { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    { x: 1e10, y: -1e10, width: 1e9, height: 1e9 },
  ];

  for (const r of cases) {
    test(`round-trips ${JSON.stringify(r)}`, () => {
      expect(unpackCGRect(packCGRect(r))).toEqual(r);
    });
  }
});

import { describe, expect, test } from 'bun:test';
import { isPngOrJpeg } from '../../../../../src/main/platform/linux/gdk-native-image';

describe('isPngOrJpeg', () => {
  test('accepts the PNG signature', () => {
    expect(isPngOrJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe(true);
  });

  test('accepts the JPEG SOI marker', () => {
    expect(isPngOrJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
  });

  test('rejects formats gdk-pixbuf would otherwise sniff and decode', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const ico = new Uint8Array([0x00, 0x00, 0x01, 0x00]);
    const tga = new Uint8Array([0x00, 0x00, 0x02, 0x00, 0x00]);
    expect(isPngOrJpeg(svg)).toBe(false);
    expect(isPngOrJpeg(ico)).toBe(false);
    expect(isPngOrJpeg(tga)).toBe(false);
  });

  test('rejects a truncated signature', () => {
    expect(isPngOrJpeg(new Uint8Array([0x89, 0x50]))).toBe(false);
    expect(isPngOrJpeg(new Uint8Array(0))).toBe(false);
  });
});

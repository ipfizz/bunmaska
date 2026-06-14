import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { nativeImage, setNativeImageBackendForTesting } from '../../../src/main/api/native-image';
import {
  removeTinyPngFile,
  TINY_PNG_HEIGHT,
  TINY_PNG_WIDTH,
  makeTinyPng,
  writeTinyPngFile,
} from '../../fixtures/tiny-png';

/**
 * Real `nativeImage` on a macOS host, driving the live `NSBitmapImageRep`/`NSData`
 * FFI. The headline assertion is that `getSize()` returns the EXACT known
 * dimensions of the generated fixture via the SCALAR `pixelsWide`/`pixelsHigh`
 * path — proving the struct-free workaround for the un-returnable `NSImage.size`
 * `NSSize` struct.
 *
 * No NSApplication / window server is needed: `NSBitmapImageRep` decoding is
 * pure Foundation/AppKit image work, not UI.
 */
if (currentPlatform() === 'macos') {
  describe('cocoa-native-image', () => {
    let fixture: string;

    beforeAll(() => {
      // Use the real macOS backend (clear any fake a unit test may have left set).
      setNativeImageBackendForTesting(undefined);
      fixture = writeTinyPngFile();
    });

    afterAll(() => {
      removeTinyPngFile(fixture);
    });

    test('createFromPath getSize returns the EXACT known fixture dimensions via the scalar path', () => {
      const image = nativeImage.createFromPath(fixture);
      expect(image.isEmpty()).toBe(false);
      const size = image.getSize();
      expect(size.width).toBe(TINY_PNG_WIDTH);
      expect(size.height).toBe(TINY_PNG_HEIGHT);
    });

    test('createFromBuffer decodes PNG bytes to the same exact dimensions', () => {
      const image = nativeImage.createFromBuffer(makeTinyPng());
      expect(image.isEmpty()).toBe(false);
      expect(image.getSize().width).toBe(TINY_PNG_WIDTH);
      expect(image.getSize().height).toBe(TINY_PNG_HEIGHT);
    });

    test('toPNG returns non-empty bytes starting with the PNG signature', () => {
      const png = nativeImage.createFromPath(fixture).toPNG();
      expect(png.length > 0).toBe(true);
      // 0x89 'P' 'N' 'G'
      expect(png[0]).toBe(0x89);
      expect(png[1]).toBe(0x50);
      expect(png[2]).toBe(0x4e);
      expect(png[3]).toBe(0x47);
    });

    test('toJPEG returns non-empty bytes starting with the JPEG SOI marker', () => {
      const jpeg = nativeImage.createFromPath(fixture).toJPEG(80);
      expect(jpeg.length > 0).toBe(true);
      // JPEG starts with the SOI marker 0xFF 0xD8.
      expect(jpeg[0]).toBe(0xff);
      expect(jpeg[1]).toBe(0xd8);
    });

    test('toDataURL starts with the PNG data-URL prefix and carries a payload', () => {
      const url = nativeImage.createFromPath(fixture).toDataURL();
      expect(url.startsWith('data:image/png;base64,')).toBe(true);
      expect(url.length > 'data:image/png;base64,'.length).toBe(true);
    });

    test('a bad path decodes to an empty image (no crash)', () => {
      const image = nativeImage.createFromPath('/no/such/bunmaska/image.png');
      expect(image.isEmpty()).toBe(true);
      expect(image.getSize()).toEqual({ width: 0, height: 0 });
      expect(image.toPNG().length).toBe(0);
      expect(image.toDataURL()).toBe('data:image/png;base64,');
    });

    test('resize redraws to the requested dimensions and round-trips through the new rep', () => {
      const img = nativeImage.createFromPath(fixture).resize({ width: 2, height: 1 });
      expect(img.isEmpty()).toBe(false);
      expect(img.getSize()).toEqual({ width: 2, height: 1 });
      expect(img.toPNG()[0]).toBe(0x89); // PNG signature — proves the CG redraw → new rep worked headless
    });

    test('resize width-only preserves aspect ratio (3x2 → width 6 → 6x4)', () => {
      expect(nativeImage.createFromBuffer(makeTinyPng()).resize({ width: 6 }).getSize()).toEqual({
        width: 6,
        height: 4,
      });
    });

    test('crop extracts the requested sub-rectangle dimensions', () => {
      const img = nativeImage
        .createFromPath(fixture)
        .crop({ x: 0, y: 0, width: 2, height: TINY_PNG_HEIGHT });
      expect(img.getSize()).toEqual({ width: 2, height: TINY_PNG_HEIGHT });
      expect(img.toPNG().length).toBeGreaterThan(0);
    });

    test('resize/crop of an empty image stay empty', () => {
      const empty = nativeImage.createFromPath('/no/such.png');
      expect(empty.resize({ width: 4, height: 4 }).isEmpty()).toBe(true);
      expect(empty.crop({ x: 0, y: 0, width: 1, height: 1 }).isEmpty()).toBe(true);
    });
  });
}

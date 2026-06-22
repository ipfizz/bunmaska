import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { nativeImage } from '../../../src/main/api/native-image';
import { windowsNativeImageBackend } from '../../../src/main/platform/windows/windows-native-image';

/**
 * Windows nativeImage against real GDI+. Image work is non-modal, so the whole
 * surface is exercised: decode (and the empty/failed path), PNG/JPEG encode,
 * resize, crop, and the public NativeImage wrapper — including the one contained
 * COM `IStream` Release on every encode. Runs only on a Windows host.
 */

/** A 1×1 PNG. */
const PNG_1x1 = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);

if (currentPlatform() === 'windows') {
  describe('Windows nativeImage backend (GDI+)', () => {
    test('decode reports dimensions for a valid PNG', () => {
      const image = windowsNativeImageBackend.decode(PNG_1x1);
      expect(image.empty).toBe(false);
      expect(image.handle).not.toBe(0n);
      expect(image.width).toBe(1);
      expect(image.height).toBe(1);
    });

    test('decode of garbage bytes is an empty image (not a throw)', () => {
      const image = windowsNativeImageBackend.decode(new Uint8Array([1, 2, 3, 4]));
      expect(image.empty).toBe(true);
    });

    test('encodePng round-trips to valid PNG bytes (exercises the COM Release)', () => {
      const { handle } = windowsNativeImageBackend.decode(PNG_1x1);
      const png = windowsNativeImageBackend.encodePng(handle);
      expect(png.length).toBeGreaterThan(0);
      // PNG magic: 89 50 4E 47.
      expect([png[0], png[1], png[2], png[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });

    test('encodeJpeg produces valid JPEG bytes', () => {
      const { handle } = windowsNativeImageBackend.decode(PNG_1x1);
      const jpeg = windowsNativeImageBackend.encodeJpeg(handle, 90);
      expect(jpeg.length).toBeGreaterThan(0);
      expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8]); // JPEG SOI marker
    });

    test('resize produces an image of the requested size', () => {
      const { handle } = windowsNativeImageBackend.decode(PNG_1x1);
      const resized = windowsNativeImageBackend.resize(handle, 8, 4);
      expect(resized.empty).toBe(false);
      expect(resized.width).toBe(8);
      expect(resized.height).toBe(4);
    });

    test('crop produces a sub-image of the requested size', () => {
      const { handle } = windowsNativeImageBackend.decode(PNG_1x1);
      const cropped = windowsNativeImageBackend.crop(handle, 0, 0, 1, 1);
      expect(cropped.empty).toBe(false);
      expect(cropped.width).toBe(1);
    });
  });

  describe('Windows public nativeImage (over the real backend)', () => {
    test('createFromBuffer → getSize / isEmpty / toPNG round-trip', () => {
      const image = nativeImage.createFromBuffer(PNG_1x1);
      expect(image.isEmpty()).toBe(false);
      expect(image.getSize()).toEqual({ width: 1, height: 1 });
      const png = image.toPNG();
      expect([png[0], png[1], png[2], png[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });

    test('resize via the public API yields a new sized image', () => {
      const resized = nativeImage.createFromBuffer(PNG_1x1).resize({ width: 5, height: 6 });
      expect(resized.getSize()).toEqual({ width: 5, height: 6 });
    });

    test('an undecodable buffer makes an empty image', () => {
      expect(nativeImage.createFromBuffer(new Uint8Array([9, 9, 9])).isEmpty()).toBe(true);
    });
  });
}

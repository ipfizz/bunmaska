import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { nativeImage, setNativeImageBackendForTesting } from '../../../src/main/api/native-image';
import { loadGdkPixbufFFI } from '../../../src/main/platform/linux/gdk-pixbuf-ffi';
import {
  removeTinyPngFile,
  TINY_PNG_HEIGHT,
  TINY_PNG_WIDTH,
  makeTinyPng,
  writeTinyPngFile,
} from '../../fixtures/tiny-png';

/**
 * Real `nativeImage` on a Linux host, driving the live GdkPixbuf FFI. Mirrors
 * the macOS integration suite: `getSize()` must return the EXACT known fixture
 * dimensions via the scalar `gdk_pixbuf_get_width`/`get_height` getters, and
 * `toPNG()` must carry the PNG signature.
 *
 * GdkPixbuf does NOT require `gtk_init_check`, but the loader must resolve the
 * library first; if `libgdk_pixbuf-2.0.so.0` is absent the load throws and the
 * test fails loudly (rather than silently passing), which is the honest signal
 * that the CI runner needs the package installed.
 */
if (currentPlatform() === 'linux') {
  describe('gdk-native-image on Linux', () => {
    test('gdk-pixbuf-ffi resolves the load/query/encode symbols', () => {
      const pixbuf = loadGdkPixbufFFI();
      for (const name of [
        'gdk_pixbuf_new_from_file',
        'gdk_pixbuf_new_from_stream',
        'gdk_pixbuf_get_width',
        'gdk_pixbuf_get_height',
        'gdk_pixbuf_save_to_bufferv',
      ] as const) {
        expect(typeof pixbuf.symbols[name]).toBe('function');
      }
    });

    test('createFromPath getSize returns the EXACT known fixture dimensions via the scalar path', () => {
      setNativeImageBackendForTesting(undefined);
      const fixture = writeTinyPngFile();
      try {
        const image = nativeImage.createFromPath(fixture);
        expect(image.isEmpty()).toBe(false);
        const size = image.getSize();
        expect(size.width).toBe(TINY_PNG_WIDTH);
        expect(size.height).toBe(TINY_PNG_HEIGHT);
      } finally {
        removeTinyPngFile(fixture);
      }
    });

    test('createFromBuffer decodes PNG bytes to the same exact dimensions', () => {
      setNativeImageBackendForTesting(undefined);
      const image = nativeImage.createFromBuffer(makeTinyPng());
      expect(image.isEmpty()).toBe(false);
      expect(image.getSize().width).toBe(TINY_PNG_WIDTH);
      expect(image.getSize().height).toBe(TINY_PNG_HEIGHT);
    });

    test('toPNG returns non-empty bytes starting with the PNG signature', () => {
      setNativeImageBackendForTesting(undefined);
      const fixture = writeTinyPngFile();
      try {
        const png = nativeImage.createFromPath(fixture).toPNG();
        expect(png.length > 0).toBe(true);
        expect(png[0]).toBe(0x89);
        expect(png[1]).toBe(0x50);
        expect(png[2]).toBe(0x4e);
        expect(png[3]).toBe(0x47);
      } finally {
        removeTinyPngFile(fixture);
      }
    });

    test('toJPEG returns non-empty bytes starting with the JPEG SOI marker', () => {
      setNativeImageBackendForTesting(undefined);
      const jpeg = nativeImage.createFromBuffer(makeTinyPng()).toJPEG(80);
      expect(jpeg.length > 0).toBe(true);
      expect(jpeg[0]).toBe(0xff);
      expect(jpeg[1]).toBe(0xd8);
    });

    test('a bad path decodes to an empty image (no crash)', () => {
      setNativeImageBackendForTesting(undefined);
      const image = nativeImage.createFromPath('/no/such/sambar/image.png');
      expect(image.isEmpty()).toBe(true);
      expect(image.getSize()).toEqual({ width: 0, height: 0 });
      expect(image.toPNG().length).toBe(0);
    });
  });
}

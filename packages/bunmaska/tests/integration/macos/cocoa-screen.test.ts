import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  cocoaScreenBackend,
  getDisplays,
  loadCoreGraphicsFFI,
} from '../../../src/main/platform/macos/cocoa-screen';

/**
 * The load-bearing proof that the CoreGraphics scalar-getter geometry path
 * actually works on a REAL macOS host: at least one display with positive
 * width/height and a scaleFactor >= 1, read live off the hardware. If bun:ffi
 * could not return these scalars this test would fail with zeros or a crash.
 */
if (currentPlatform() === 'macos') {
  describe('cocoa-screen on a real macOS host', () => {
    test('loadCoreGraphicsFFI resolves the display scalar getters', () => {
      const { symbols } = loadCoreGraphicsFFI();
      for (const name of [
        'CGGetActiveDisplayList',
        'CGMainDisplayID',
        'CGDisplayPixelsWide',
        'CGDisplayPixelsHigh',
        'CGDisplayRotation',
        'CGDisplayIsBuiltin',
        'CGDisplayIsMain',
        'CGDisplayCopyDisplayMode',
        'CGDisplayModeGetWidth',
        'CGDisplayModeGetPixelWidth',
        'CGDisplayModeRelease',
      ] as const) {
        expect(typeof symbols[name]).toBe('function');
      }
    });

    test('getDisplays returns at least one display with sane geometry', () => {
      const displays = getDisplays();
      expect(displays.length).toBeGreaterThanOrEqual(1);

      for (const d of displays) {
        expect(d.bounds.width).toBeGreaterThan(0);
        expect(d.bounds.height).toBeGreaterThan(0);
        expect(d.scaleFactor).toBeGreaterThanOrEqual(1);
        expect(Number.isFinite(d.rotation)).toBe(true);
        expect(typeof d.internal).toBe('boolean');
        // workArea mirrors bounds on macOS v1.
        expect(d.workArea).toEqual(d.bounds);
      }
    });

    test('exactly one display reports itself as primary', () => {
      const primaries = getDisplays().filter((d) => d.primary);
      expect(primaries.length).toBe(1);
    });

    test('the backend exposes a {0,0}-safe cursor point (v1 limit)', () => {
      const point = cocoaScreenBackend.getCursorScreenPoint();
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    });
  });
}

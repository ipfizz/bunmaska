import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { screen } from '../../../src/main/api/screen';
import { windowsScreenBackend } from '../../../src/main/platform/windows/windows-screen';

/**
 * Windows screen backend against the real display configuration. A CI runner has
 * at least one monitor, so these assert SHAPE and INVARIANTS (positive bounds,
 * exactly one primary, scale >= 1) rather than fixed pixel values. Runs only on a
 * Windows host; inert elsewhere.
 */
if (currentPlatform() === 'windows') {
  describe('Windows screen backend', () => {
    test('getDisplays returns at least one display with positive bounds', () => {
      const displays = windowsScreenBackend.getDisplays();
      expect(displays.length).toBeGreaterThanOrEqual(1);
      for (const d of displays) {
        expect(d.bounds.width).toBeGreaterThan(0);
        expect(d.bounds.height).toBeGreaterThan(0);
        expect(d.scaleFactor).toBeGreaterThanOrEqual(1);
        // The work area fits within the monitor bounds.
        expect(d.workArea.width).toBeLessThanOrEqual(d.bounds.width);
        expect(d.workArea.height).toBeLessThanOrEqual(d.bounds.height);
      }
    });

    test('exactly one display is flagged primary', () => {
      const primaries = windowsScreenBackend.getDisplays().filter((d) => d.primary);
      expect(primaries).toHaveLength(1);
    });

    test('getCursorScreenPoint returns integer coordinates', () => {
      const point = windowsScreenBackend.getCursorScreenPoint();
      expect(Number.isInteger(point.x)).toBe(true);
      expect(Number.isInteger(point.y)).toBe(true);
    });

    test('the public screen.getPrimaryDisplay derives a usable display', () => {
      const primary = screen.getPrimaryDisplay();
      expect(primary.size.width).toBeGreaterThan(0);
      expect(primary.size.height).toBeGreaterThan(0);
      expect(primary.workAreaSize.width).toBeGreaterThan(0);
    });

    test('getDisplayNearestPoint at the primary origin returns a display', () => {
      const primary = screen.getPrimaryDisplay();
      const nearest = screen.getDisplayNearestPoint({
        x: primary.bounds.x + 1,
        y: primary.bounds.y + 1,
      });
      expect(nearest.size.width).toBeGreaterThan(0);
    });
  });
}

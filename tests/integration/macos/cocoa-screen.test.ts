import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { cocoaScreenBackend, getDisplays } from '../../../src/main/platform/macos/cocoa-screen';
import type { RawDisplay } from '../../../src/main/platform/services';

const primaryOf = (displays: readonly RawDisplay[]): RawDisplay => {
  const primary = displays.find((d) => d.primary);
  if (primary === undefined) {
    throw new Error('no primary display');
  }
  return primary;
};

if (currentPlatform() === 'macos') {
  describe('cocoa-screen on a real macOS host', () => {
    test('getDisplays returns at least one display with sane geometry', () => {
      const displays = getDisplays();
      expect(displays.length).toBeGreaterThanOrEqual(1);

      for (const d of displays) {
        expect(d.bounds.width).toBeGreaterThan(0);
        expect(d.bounds.height).toBeGreaterThan(0);
        expect(d.scaleFactor).toBeGreaterThanOrEqual(1);
        expect(Number.isFinite(d.rotation)).toBe(true);
      }
    });

    test('exactly one display reports itself as primary, at the global origin', () => {
      const displays = getDisplays();
      expect(displays.filter((d) => d.primary).length).toBe(1);
      expect(primaryOf(displays).bounds.x).toBe(0);
      expect(primaryOf(displays).bounds.y).toBe(0);
    });

    test("the primary display's workArea sits below the menu bar, inside its bounds", () => {
      const { bounds, workArea } = primaryOf(getDisplays());
      expect(workArea.y).toBeGreaterThan(bounds.y);
      expect(workArea.y + workArea.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    });

    test('the cursor point lies on some display', () => {
      const { x, y } = cocoaScreenBackend.getCursorScreenPoint();
      const onDisplay = getDisplays().some(
        ({ bounds: b }) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height,
      );
      expect(onDisplay).toBe(true);
    });
  });
}

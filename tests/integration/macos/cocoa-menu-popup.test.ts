import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { cancelMenuTracking, realizeMenu } from '../../../src/main/platform/macos/cocoa-menu';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

/**
 * Build-side checks for the macOS context-menu popup. The BLOCKING show
 * (`popUpMenuPositioningItem:atLocation:inView:`) runs a nested AppKit tracking loop until a
 * human dismisses it, so — exactly like `cocoa-dialog`'s `runModal` — it is NOT invoked
 * unattended in CI; it is exercised in real apps. Here we verify the wiring: the selector
 * resolves, a menu realizes, and `cancelMenuTracking` is a safe no-op when not tracking.
 */
if (currentPlatform() === 'macos') {
  describe('cocoa-menu popup (build-side)', () => {
    test('the popUp selector resolves and cancelMenuTracking is a safe no-op', () => {
      const menu = realizeMenu([
        {
          label: 'Copy',
          type: 'normal',
          enabled: true,
          keyEquivalent: '',
          onClick: () => undefined,
        },
      ]);
      expect(cocoa().selectors.get('popUpMenuPositioningItem:atLocation:inView:')).not.toBe(0n);
      expect(() => cancelMenuTracking(menu)).not.toThrow();
    });
  });
}

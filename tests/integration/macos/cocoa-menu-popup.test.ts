import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { cancelMenuTracking, realizeMenu } from '../../../src/main/platform/macos/cocoa-menu';

// The popup itself blocks in a nested tracking loop until a human dismisses it (D040), so only
// the cancel path runs unattended; a wrong selector here aborts the process.
if (currentPlatform() === 'macos') {
  describe('cocoa-menu popup', () => {
    test('cancelMenuTracking on a menu that is not tracking is a no-op', () => {
      const menu = realizeMenu([
        {
          label: 'Copy',
          type: 'normal',
          enabled: true,
          keyEquivalent: '',
          onClick: () => undefined,
        },
      ]);
      expect(() => cancelMenuTracking(menu)).not.toThrow();
    });
  });
}

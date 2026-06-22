import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { observePowerEvents } from '../../../src/main/platform/macos/cocoa-power';

// Exercises the real NSWorkspace + distributed notification observer registration
// on macOS. A real sleep/wake/lock can't be triggered in CI, so the observers are
// verified to attach without throwing (defineObjcClass + addObserver across both
// notification centers).
if (currentPlatform() === 'macos') {
  describe('cocoa-power', () => {
    test('observePowerEvents registers the sleep/wake/lock observers without throwing', () => {
      expect(() =>
        observePowerEvents({
          onSuspend: () => undefined,
          onResume: () => undefined,
          onLockScreen: () => undefined,
          onUnlockScreen: () => undefined,
        }),
      ).not.toThrow();
    });
  });
}

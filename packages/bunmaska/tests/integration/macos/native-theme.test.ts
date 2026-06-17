import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  observeAppearanceChange,
  shouldUseDarkColors,
} from '../../../src/main/platform/macos/cocoa-native-theme';

// Exercises the real `AppleInterfaceStyle` read and the
// `NSDistributedNotificationCenter` observer registration on macOS. We cannot
// force a system theme flip in CI, so the observer is verified to attach without
// throwing (defineObjcClass + addObserver:selector:name:object:).
if (currentPlatform() === 'macos') {
  describe('cocoa-native-theme', () => {
    test('shouldUseDarkColors returns a boolean', () => {
      expect(typeof shouldUseDarkColors()).toBe('boolean');
    });

    test('observeAppearanceChange registers a distributed-notification observer without throwing', () => {
      expect(() => observeAppearanceChange(() => undefined)).not.toThrow();
    });
  });
}

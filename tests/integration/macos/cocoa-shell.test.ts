import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { beep, openPath, showItemInFolder } from '../../../src/main/platform/macos/cocoa-shell';

if (currentPlatform() === 'macos') {
  describe('cocoa-shell', () => {
    // An empty path makes a nil NSURL; neither call may reach Finder or LaunchServices.
    test('showItemInFolder("") is a no-op instead of aborting on a nil URL', () => {
      expect(() => showItemInFolder('')).not.toThrow();
    });

    test('openPath("") reports failure', () => {
      expect(openPath('')).toBe(false);
    });

    test('beep does not throw', () => {
      expect(() => beep()).not.toThrow();
    });
  });
}

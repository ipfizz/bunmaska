import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  bounceDock,
  getDockBadge,
  isActive,
  isHidden,
  setActivationPolicy,
  setDockBadge,
  showAboutPanel,
} from '../../../src/main/platform/macos/cocoa-app';

/** Drives the real NSApplication app-level operations on macOS. */
if (currentPlatform() === 'macos') {
  describe('cocoa-app NSApplication operations', () => {
    test('setActivationPolicy does not throw', () => {
      expect(() => setActivationPolicy('regular')).not.toThrow();
    });

    test('isActive / isHidden return booleans', () => {
      expect(typeof isActive()).toBe('boolean');
      expect(typeof isHidden()).toBe('boolean');
    });

    test('dock badge round-trips and clears', () => {
      setDockBadge('7');
      expect(getDockBadge()).toBe('7');
      setDockBadge('');
      expect(getDockBadge()).toBe('');
    });

    // Not invoked: showAboutPanel opens a window, bounceDock bounces the dock.
    test('bounceDock and showAboutPanel resolve as callable exports', () => {
      expect(typeof bounceDock).toBe('function');
      expect(typeof showAboutPanel).toBe('function');
    });
  });
}

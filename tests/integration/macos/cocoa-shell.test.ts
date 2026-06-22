import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { beep, openExternal, showItemInFolder } from '../../../src/main/platform/macos/cocoa-shell';

if (currentPlatform() === 'macos') {
  describe('cocoa-shell', () => {
    // Not invoked: openExternal pops a LaunchServices dialog, showItemInFolder opens Finder.
    test('openExternal resolves as a callable FFI export', () => {
      expect(typeof openExternal).toBe('function');
    });

    test('showItemInFolder resolves as a callable FFI export', () => {
      expect(typeof showItemInFolder).toBe('function');
    });

    test('beep does not throw', () => {
      expect(() => beep()).not.toThrow();
    });
  });
}

import { describe, expect, test } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import { loadWebKitGtkFFI } from '../../../../../src/main/platform/linux/webkitgtk-ffi';

describe('loadWebKitGtkFFI export', () => {
  test('is a function', () => {
    expect(typeof loadWebKitGtkFFI).toBe('function');
  });
});

if (currentPlatform() !== 'linux') {
  describe('loadWebKitGtkFFI on non-Linux hosts', () => {
    test('throws UnsupportedPlatformError', () => {
      expect(() => loadWebKitGtkFFI()).toThrow(UnsupportedPlatformError);
    });
  });
}

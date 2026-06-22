import { describe, expect, test } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import { createMacOSDrain } from '../../../../../src/main/platform/macos/cocoa-run-loop';

describe('createMacOSDrain export', () => {
  test('is a function', () => {
    expect(typeof createMacOSDrain).toBe('function');
  });
});

if (currentPlatform() !== 'macos') {
  describe('createMacOSDrain on non-macOS hosts', () => {
    test('throws UnsupportedPlatformError', () => {
      expect(() => createMacOSDrain()).toThrow(UnsupportedPlatformError);
    });
  });
}

import { describe, expect, test } from 'bun:test';
import { SambarError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import { loadCocoaFFI } from '../../../../../src/main/platform/macos/cocoa-ffi';

describe('loadCocoaFFI export', () => {
  test('is a function', () => {
    expect(typeof loadCocoaFFI).toBe('function');
  });
});

if (currentPlatform() !== 'macos') {
  describe('loadCocoaFFI on non-macOS hosts', () => {
    test('throws SambarError', () => {
      expect(() => loadCocoaFFI()).toThrow(SambarError);
    });

    test('the error message mentions the current platform', () => {
      expect(() => loadCocoaFFI()).toThrow(/only supported on macOS/);
    });
  });
}

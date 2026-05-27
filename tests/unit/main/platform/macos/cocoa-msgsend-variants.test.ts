import { describe, expect, test } from 'bun:test';
import { SambarError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import { msgSendInitWithContentRect } from '../../../../../src/main/platform/macos/cocoa-msgsend-variants';

describe('msgSendInitWithContentRect export', () => {
  test('is a function', () => {
    expect(typeof msgSendInitWithContentRect).toBe('function');
  });
});

if (currentPlatform() !== 'macos') {
  describe('msgSendInitWithContentRect on non-macOS hosts', () => {
    test('throws SambarError', () => {
      expect(() => msgSendInitWithContentRect(0n, 0n, [0, 0, 0, 0], 0n, 0n, false)).toThrow(
        SambarError,
      );
    });
  });
}

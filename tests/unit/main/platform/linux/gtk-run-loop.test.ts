import { describe, expect, test } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import { createLinuxDrain } from '../../../../../src/main/platform/linux/gtk-run-loop';

describe('createLinuxDrain export', () => {
  test('is a function', () => {
    expect(typeof createLinuxDrain).toBe('function');
  });
});

if (currentPlatform() !== 'linux') {
  describe('createLinuxDrain on non-Linux hosts', () => {
    test('throws UnsupportedPlatformError', () => {
      expect(() => createLinuxDrain()).toThrow(UnsupportedPlatformError);
    });
  });
}

import { describe, expect, test } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../src/common/errors';
import { currentPlatform } from '../../../../src/common/platform';
import { clipboard } from '../../../../src/main/api/clipboard';

describe('clipboard export', () => {
  test('exposes readText, writeText and clear', () => {
    expect(typeof clipboard.readText).toBe('function');
    expect(typeof clipboard.writeText).toBe('function');
    expect(typeof clipboard.clear).toBe('function');
  });
});

if (currentPlatform() !== 'macos') {
  describe('clipboard on platforms without a backend', () => {
    test('readText throws UnsupportedPlatformError', () => {
      expect(() => clipboard.readText()).toThrow(UnsupportedPlatformError);
    });

    test('writeText throws UnsupportedPlatformError', () => {
      expect(() => clipboard.writeText('x')).toThrow(UnsupportedPlatformError);
    });
  });
}

import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { nsString, nsStringToString } from '../../../src/main/platform/macos/cocoa-foundation';

if (currentPlatform() === 'macos') {
  describe('NSString bridging', () => {
    test('nsString creates a non-null NSString from a JS string', () => {
      expect(nsString('hello')).not.toBe(0n);
    });

    test('nsString -> nsStringToString round-trips ASCII', () => {
      expect(nsStringToString(nsString('Bunmaska'))).toBe('Bunmaska');
    });

    test('round-trips the empty string', () => {
      expect(nsStringToString(nsString(''))).toBe('');
    });

    test('round-trips UTF-8 multibyte content', () => {
      expect(nsStringToString(nsString('café — 日本語'))).toBe('café — 日本語');
    });

    test('nsStringToString returns empty string for a null handle', () => {
      expect(nsStringToString(0n)).toBe('');
    });
  });
}

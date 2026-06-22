import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { nativeTheme } from '../../../src/main/api/native-theme';
import {
  readRegistryDwordCurrentUser,
  windowsShouldUseDarkColors,
} from '../../../src/main/platform/windows/windows-native-theme';

/**
 * Windows nativeTheme against the real registry. The machine's actual light/dark
 * setting varies, so these assert SHAPE and CONSISTENCY rather than a fixed value:
 * the DWORD read returns a sane 0/1 (or undefined), a missing value reads cleanly
 * as undefined, and the public `shouldUseDarkColors` agrees with the raw read.
 * Runs only on a Windows host; inert elsewhere.
 */
const PERSONALIZE = 'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';

if (currentPlatform() === 'windows') {
  describe('Windows nativeTheme (registry)', () => {
    test('reading AppsUseLightTheme yields 0, 1, or undefined', () => {
      const value = readRegistryDwordCurrentUser(PERSONALIZE, 'AppsUseLightTheme');
      if (value !== undefined) {
        expect([0, 1]).toContain(value);
      }
    });

    test('a missing value reads cleanly as undefined (not a throw)', () => {
      expect(
        readRegistryDwordCurrentUser(PERSONALIZE, 'BunmaskaDefinitelyNotAValue'),
      ).toBeUndefined();
    });

    test('a missing subkey reads as undefined', () => {
      expect(readRegistryDwordCurrentUser('Software\\Bunmaska\\NoSuchKey', 'x')).toBeUndefined();
    });

    test('windowsShouldUseDarkColors is a boolean consistent with the raw DWORD', () => {
      const dark = windowsShouldUseDarkColors();
      expect(typeof dark).toBe('boolean');
      const raw = readRegistryDwordCurrentUser(PERSONALIZE, 'AppsUseLightTheme');
      expect(dark).toBe(raw === 0);
    });

    test('the public nativeTheme.shouldUseDarkColors honors the OS under themeSource system', () => {
      nativeTheme.themeSource = 'system';
      expect(nativeTheme.shouldUseDarkColors).toBe(windowsShouldUseDarkColors());
      // The light/dark overrides still win regardless of the OS value.
      nativeTheme.themeSource = 'light';
      expect(nativeTheme.shouldUseDarkColors).toBe(false);
      nativeTheme.themeSource = 'dark';
      expect(nativeTheme.shouldUseDarkColors).toBe(true);
      nativeTheme.themeSource = 'system';
    });
  });
}

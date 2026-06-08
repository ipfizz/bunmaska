import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import {
  observeAppearanceChange,
  shouldUseDarkColors,
} from '../../../src/main/platform/linux/gtk-native-theme';

// Exercises the real `gtk_settings_get_default` + `g_object_get` read and the
// `notify::gtk-application-prefer-dark-theme` observer registration on Linux.
if (currentPlatform() === 'linux') {
  describe('gtk-native-theme', () => {
    test('shouldUseDarkColors reads a boolean from GtkSettings', () => {
      loadGtkFFI().symbols.gtk_init_check();
      expect(typeof shouldUseDarkColors()).toBe('boolean');
    });

    test('observeAppearanceChange connects to GtkSettings without throwing', () => {
      loadGtkFFI().symbols.gtk_init_check();
      expect(() => observeAppearanceChange(() => undefined)).not.toThrow();
    });
  });
}

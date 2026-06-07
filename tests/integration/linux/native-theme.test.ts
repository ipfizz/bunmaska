import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { shouldUseDarkColors } from '../../../src/main/platform/linux/gtk-native-theme';

// Exercises the real `gtk_settings_get_default` + `g_object_get` read on Linux.
if (currentPlatform() === 'linux') {
  describe('gtk-native-theme', () => {
    test('shouldUseDarkColors reads a boolean from GtkSettings', () => {
      loadGtkFFI().symbols.gtk_init_check();
      expect(typeof shouldUseDarkColors()).toBe('boolean');
    });
  });
}

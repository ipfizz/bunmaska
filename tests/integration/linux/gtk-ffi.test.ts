import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { cstr } from '../../../src/main/platform/cstr';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';

if (currentPlatform() === 'linux') {
  const hasDisplay = loadGtkFFI().symbols.gtk_init_check() !== 0;

  describe.skipIf(!hasDisplay)('GTK FFI on a real display', () => {
    test('gtk_about_dialog_new constructs a dialog (showAboutPanel)', () => {
      expect(loadGtkFFI().symbols.gtk_about_dialog_new()).not.toBeNull();
    });

    test('drives a real window through the GTK 4 window symbols', () => {
      const lib = loadGtkFFI();
      const window = lib.symbols.gtk_window_new();
      expect(window).not.toBeNull();
      lib.symbols.gtk_window_set_title(window, cstr('Bunmaska'));
      lib.symbols.gtk_window_set_default_size(window, 400, 300);
      lib.symbols.gtk_widget_set_visible(window, 1);
      lib.symbols.gtk_window_present(window);
      expect(lib.symbols.gtk_window_is_maximized(window)).toBe(0);
      lib.symbols.gtk_window_destroy(window);
    });
  });
}

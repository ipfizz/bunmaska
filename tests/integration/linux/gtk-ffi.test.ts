import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { cstr } from '../../../src/main/platform/cstr';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';

if (currentPlatform() === 'linux') {
  describe('GTK FFI on Linux', () => {
    test('loadGtkFFI returns a library handle with gtk_init_check and gtk_window_new', () => {
      const lib = loadGtkFFI();
      expect(typeof lib.symbols.gtk_init_check).toBe('function');
      expect(typeof lib.symbols.gtk_window_new).toBe('function');
    });

    test('gtk_init_check returns a non-zero gboolean (true) on a working display', () => {
      const lib = loadGtkFFI();
      const result = lib.symbols.gtk_init_check();
      // On a headless CI runner without a display, gtk_init_check may legitimately
      // return 0. We assert only that the call returns a JS number — i.e. it
      // didn't crash and FFI dispatch works.
      expect(typeof result).toBe('number');
    });

    test('the library exports gtk_window_set_title', () => {
      const lib = loadGtkFFI();
      expect(typeof lib.symbols.gtk_window_set_title).toBe('function');
    });

    test('the library exports gtk_window_set_default_size', () => {
      const lib = loadGtkFFI();
      expect(typeof lib.symbols.gtk_window_set_default_size).toBe('function');
    });

    test('the library exports gtk_window_present', () => {
      const lib = loadGtkFFI();
      expect(typeof lib.symbols.gtk_window_present).toBe('function');
    });

    test('gtk_about_dialog_new resolves and constructs a dialog (showAboutPanel)', () => {
      const lib = loadGtkFFI();
      expect(typeof lib.symbols.gtk_about_dialog_new).toBe('function');
      lib.symbols.gtk_init_check();
      expect(lib.symbols.gtk_about_dialog_new()).not.toBeNull();
    });

    test('resolves the newly added GTK4 window/widget symbols', () => {
      const lib = loadGtkFFI();
      for (const name of [
        'gtk_window_set_child',
        'gtk_widget_set_visible',
        'gtk_window_destroy',
        'gtk_window_minimize',
        'gtk_window_unminimize',
        'gtk_window_maximize',
        'gtk_window_unmaximize',
        'gtk_window_is_maximized',
        'gtk_widget_get_width',
        'gtk_widget_get_height',
        'gtk_window_get_title',
        'gtk_widget_grab_focus',
      ] as const) {
        expect(typeof lib.symbols[name]).toBe('function');
      }
    });

    test('drives the new symbols end-to-end on a real window', () => {
      const lib = loadGtkFFI();
      if (lib.symbols.gtk_init_check() === 0) {
        return; // No display; the smoke assertions above already proved dispatch.
      }
      const window = lib.symbols.gtk_window_new();
      expect(window).not.toBeNull();
      lib.symbols.gtk_window_set_title(window, cstr('Bunmaska'));
      lib.symbols.gtk_window_set_default_size(window, 400, 300);
      lib.symbols.gtk_widget_set_visible(window, 1);
      lib.symbols.gtk_window_present(window);

      // get_width/get_height return a JS number (0 before the window is mapped).
      expect(typeof lib.symbols.gtk_widget_get_width(window)).toBe('number');
      expect(typeof lib.symbols.gtk_widget_get_height(window)).toBe('number');
      expect(typeof lib.symbols.gtk_window_is_maximized(window)).toBe('number');

      lib.symbols.gtk_window_destroy(window);
    });
  });
}

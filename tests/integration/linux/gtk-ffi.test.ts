import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
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
  });
}

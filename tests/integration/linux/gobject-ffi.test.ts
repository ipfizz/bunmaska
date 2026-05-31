import { JSCallback } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { cstr } from '../../../src/main/platform/cstr';
import { loadGObjectFFI } from '../../../src/main/platform/linux/gobject-ffi';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';

if (currentPlatform() === 'linux') {
  describe('GObject FFI on Linux', () => {
    test('resolves the signal + refcount + construct symbols', () => {
      const lib = loadGObjectFFI();
      for (const name of [
        'g_signal_connect_data',
        'g_signal_handler_disconnect',
        'g_object_ref',
        'g_object_unref',
        'g_object_new',
      ] as const) {
        expect(typeof lib.symbols[name]).toBe('function');
      }
    });

    test('connects and disconnects a real signal handler on a GtkWindow', () => {
      const gtk = loadGtkFFI();
      if (gtk.symbols.gtk_init_check() === 0) {
        return; // No display.
      }
      const gobject = loadGObjectFFI();
      const window = gtk.symbols.gtk_window_new();

      const callback = new JSCallback(() => 0, { args: ['ptr', 'ptr'], returns: 'i32' });
      const handlerId = gobject.symbols.g_signal_connect_data(
        window,
        cstr('close-request'),
        callback.ptr,
        null,
        null,
        0,
      );
      expect(typeof handlerId).toBe('bigint');
      expect(handlerId).not.toBe(0n);

      gobject.symbols.g_signal_handler_disconnect(window, handlerId);
      callback.close();
      gtk.symbols.gtk_window_destroy(window);
    });
  });
}

import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadGdkFFI } from '../../../src/main/platform/linux/gdk-ffi';
import { getDisplays } from '../../../src/main/platform/linux/gdk-screen';
import { loadGioFFI } from '../../../src/main/platform/linux/gio-ffi';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';

if (currentPlatform() === 'linux') {
  describe('GDK/GIO screen FFI on Linux', () => {
    test('gdk-ffi resolves the new GdkMonitor symbols', () => {
      const gdk = loadGdkFFI();
      for (const name of [
        'gdk_display_get_monitors',
        'gdk_monitor_get_geometry',
        'gdk_monitor_get_scale_factor',
      ] as const) {
        expect(typeof gdk.symbols[name]).toBe('function');
      }
    });

    test('gio-ffi resolves the new GListModel symbols', () => {
      const gio = loadGioFFI();
      for (const name of ['g_list_model_get_n_items', 'g_list_model_get_item'] as const) {
        expect(typeof gio.symbols[name]).toBe('function');
      }
    });

    test('getDisplays returns at least one monitor with positive geometry under a display', () => {
      const gtk = loadGtkFFI();
      if (gtk.symbols.gtk_init_check() === 0) {
        return; // No display (no Xvfb); the symbol-resolution tests above stand.
      }
      const displays = getDisplays();
      expect(displays.length).toBeGreaterThanOrEqual(1);
      for (const d of displays) {
        expect(d.bounds.width).toBeGreaterThan(0);
        expect(d.bounds.height).toBeGreaterThan(0);
        expect(d.scaleFactor).toBeGreaterThanOrEqual(1);
        // workArea mirrors bounds on Linux v1 (no GdkMonitor work-area API).
        expect(d.workArea).toEqual(d.bounds);
      }
      // Exactly one display is flagged primary (index 0).
      expect(displays.filter((d) => d.primary).length).toBe(1);
    });
  });
}

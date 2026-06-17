import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadGDBusFFI } from '../../../src/main/platform/linux/gdbus-ffi';
import { loadGlibFFI } from '../../../src/main/platform/linux/glib-ffi';
import { loadGdkPixbufFFI } from '../../../src/main/platform/linux/gdk-pixbuf-ffi';
import {
  nodeInfoLookupInterface,
  nodeInfoNewForXml,
} from '../../../src/main/platform/linux/linux-dbus';
import { linuxTrayBackend, SNI_XML } from '../../../src/main/platform/linux/sni-tray';

// Linux-only (xvfb). The live SNI path is gated by BUNMASKA_ENABLE_LINUX_TRAY (CI never sets
// it), so create() is a fast inert no-op here. CI CAN verify: the object-export + GVariant
// + pixbuf-accessor symbols resolve, and that the embedded introspection XML actually parses
// + the interface resolves (node-info parsing is local — no bus needed).
if (currentPlatform() === 'linux') {
  describe('Linux Tray backend (StatusNotifierItem)', () => {
    test('the object-export + GVariant-builder + pixbuf symbols resolve', () => {
      const gdbus = loadGDBusFFI();
      for (const name of [
        'g_dbus_connection_register_object',
        'g_dbus_connection_unregister_object',
        'g_dbus_node_info_new_for_xml',
        'g_dbus_node_info_lookup_interface',
        'g_dbus_connection_emit_signal',
        'g_dbus_connection_get_unique_name',
        'g_dbus_method_invocation_return_value',
      ] as const) {
        expect(typeof gdbus.symbols[name]).toBe('function');
      }
      const glib = loadGlibFFI();
      for (const name of [
        'g_variant_type_new',
        'g_variant_builder_new',
        'g_variant_builder_add_value',
        'g_variant_builder_end',
        'g_variant_new_from_data',
        'g_variant_new_int32',
        'g_variant_new_object_path',
      ] as const) {
        expect(typeof glib.symbols[name]).toBe('function');
      }
      const pix = loadGdkPixbufFFI();
      for (const name of [
        'gdk_pixbuf_get_pixels',
        'gdk_pixbuf_get_rowstride',
        'gdk_pixbuf_get_n_channels',
        'gdk_pixbuf_get_has_alpha',
      ] as const) {
        expect(typeof pix.symbols[name]).toBe('function');
      }
    });

    test('the embedded SNI introspection XML parses and the interface resolves', () => {
      const node = nodeInfoNewForXml(SNI_XML);
      expect(node).not.toBeNull();
      const iface = nodeInfoLookupInterface(node as never, 'org.kde.StatusNotifierItem');
      expect(iface).not.toBeNull();
    });

    test('create() is a fast inert no-op when the gate is off', () => {
      expect(process.env['BUNMASKA_ENABLE_LINUX_TRAY']).not.toBe('1');
      const start = performance.now();
      const tray = linuxTrayBackend.create('/tmp/nonexistent-icon.png');
      expect(() => {
        tray.setToolTip('hi');
        tray.setImage('/tmp/other.png');
        tray.destroy();
      }).not.toThrow();
      expect(performance.now() - start).toBeLessThan(1000);
      expect(tray.isDestroyed()).toBe(true);
    });
  });
}

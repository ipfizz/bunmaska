import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadGDBusFFI } from '../../../src/main/platform/linux/gdbus-ffi';
import { loadGlibFFI } from '../../../src/main/platform/linux/glib-ffi';
import {
  getSystemBus,
  probeSystemBusUnchecked,
  resetSystemBusCacheForTesting,
} from '../../../src/main/platform/linux/linux-dbus';
import { observePowerEvents } from '../../../src/main/platform/linux/linux-power-monitor';

// Linux-only (xvfb). Proves the GDBus symbols resolve and — critically — that the bus
// calls resolve FAST and never hang (the 4-hour-hang scar class). The live system-bus
// path is gated by BUNMASKA_ENABLE_LINUX_POWER, which CI never sets, so getSystemBus() is a
// deterministic null no-op here; probeSystemBusUnchecked() exercises the REAL
// g_bus_get_sync to confirm it returns promptly whether or not a system bus is present.
if (currentPlatform() === 'linux') {
  describe('Linux powerMonitor backend (GDBus/logind)', () => {
    test('loadGDBusFFI resolves every GDBus symbol', () => {
      const gdbus = loadGDBusFFI();
      for (const name of [
        'g_bus_get_sync',
        'g_dbus_connection_signal_subscribe',
        'g_dbus_connection_signal_unsubscribe',
      ] as const) {
        expect(typeof gdbus.symbols[name]).toBe('function');
      }
    });

    test('the new GVariant glib symbols resolve', () => {
      const glib = loadGlibFFI();
      for (const name of [
        'g_variant_get_boolean',
        'g_variant_get_child_value',
        'g_variant_unref',
        'g_variant_n_children',
        'g_variant_get_type_string',
      ] as const) {
        expect(typeof glib.symbols[name]).toBe('function');
      }
    });

    test('getSystemBus() is a fast null no-op without the env gate', () => {
      resetSystemBusCacheForTesting();
      const start = performance.now();
      const bus = getSystemBus();
      expect(performance.now() - start).toBeLessThan(2000);
      expect(bus).toBeNull();
    });

    test('the real g_bus_get_sync resolves promptly and never hangs', () => {
      // Returns a connection (bus present) or null (absent); either way it must be FAST.
      const start = performance.now();
      const conn = probeSystemBusUnchecked();
      expect(performance.now() - start).toBeLessThan(5000);
      expect(conn === null || typeof conn === 'number').toBe(true);
    });

    test('observePowerEvents is a safe no-op when the gate is off', () => {
      resetSystemBusCacheForTesting();
      const fired: string[] = [];
      expect(() =>
        observePowerEvents({
          onSuspend: () => fired.push('suspend'),
          onResume: () => fired.push('resume'),
          onLockScreen: () => fired.push('lock-screen'),
          onUnlockScreen: () => fired.push('unlock-screen'),
        }),
      ).not.toThrow();
      expect(fired).toEqual([]);
    });
  });
}

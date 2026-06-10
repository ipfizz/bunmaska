import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadGDBusFFI } from '../../../src/main/platform/linux/gdbus-ffi';
import { loadGlibFFI } from '../../../src/main/platform/linux/glib-ffi';
import {
  getSessionBus,
  probeSessionBusUnchecked,
  resetSessionBusCacheForTesting,
} from '../../../src/main/platform/linux/linux-dbus';
import { linuxPowerSaveBlockerBackend } from '../../../src/main/platform/linux/linux-power-save-blocker';

// Linux-only (xvfb). Proves the method-call symbols resolve and that the SESSION-bus path
// resolves FAST and never hangs (the bounded call_sync + the gate). The live path is gated
// by SAMBAR_ENABLE_LINUX_POWER_BLOCKER, which CI never sets, so getSessionBus() is a
// deterministic null no-op; probeSessionBusUnchecked() exercises the REAL g_bus_get_sync.
if (currentPlatform() === 'linux') {
  describe('Linux powerSaveBlocker backend (GDBus/ScreenSaver)', () => {
    test('the method-call + GVariant builder symbols resolve', () => {
      const gdbus = loadGDBusFFI();
      expect(typeof gdbus.symbols.g_dbus_connection_call_sync).toBe('function');
      const glib = loadGlibFFI();
      for (const name of [
        'g_variant_new_string',
        'g_variant_new_uint32',
        'g_variant_new_tuple',
        'g_variant_get_uint32',
      ] as const) {
        expect(typeof glib.symbols[name]).toBe('function');
      }
    });

    test('getSessionBus() is a fast null no-op without the env gate', () => {
      resetSessionBusCacheForTesting();
      const start = performance.now();
      const bus = getSessionBus();
      expect(performance.now() - start).toBeLessThan(2000);
      expect(bus).toBeNull();
    });

    test('the real g_bus_get_sync(SESSION) resolves promptly and never hangs', () => {
      const start = performance.now();
      const conn = probeSessionBusUnchecked();
      expect(performance.now() - start).toBeLessThan(5000);
      expect(conn === null || typeof conn === 'number').toBe(true);
    });

    test('acquire/release are safe fast no-ops when the gate is off', () => {
      resetSessionBusCacheForTesting();
      const start = performance.now();
      const handle = linuxPowerSaveBlockerBackend.acquire('prevent-app-suspension');
      expect(() => linuxPowerSaveBlockerBackend.release(handle ?? 0)).not.toThrow();
      expect(performance.now() - start).toBeLessThan(1000);
      expect(handle).toBeNull();
    });
  });
}

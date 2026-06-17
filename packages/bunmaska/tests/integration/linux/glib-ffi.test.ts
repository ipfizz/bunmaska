import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadGlibFFI } from '../../../src/main/platform/linux/glib-ffi';

if (currentPlatform() === 'linux') {
  describe('GLib FFI on Linux', () => {
    test('resolves the main-context, g_free, and default-context symbols', () => {
      const lib = loadGlibFFI();
      for (const name of [
        'g_main_context_default',
        'g_main_context_iteration',
        'g_main_context_pending',
        'g_free',
      ] as const) {
        expect(typeof lib.symbols[name]).toBe('function');
      }
    });

    test('g_free is a NULL-safe no-op', () => {
      const lib = loadGlibFFI();
      expect(() => lib.symbols.g_free(null)).not.toThrow();
    });

    test('g_main_context_default returns a non-null pointer', () => {
      const lib = loadGlibFFI();
      expect(lib.symbols.g_main_context_default()).not.toBeNull();
    });
  });
}

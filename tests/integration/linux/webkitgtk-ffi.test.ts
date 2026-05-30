import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadWebKitGtkFFI } from '../../../src/main/platform/linux/webkitgtk-ffi';

if (currentPlatform() === 'linux') {
  describe('WebKitGTK FFI on Linux', () => {
    test('resolves the core web-view symbols (proves the library + names are correct)', () => {
      const lib = loadWebKitGtkFFI();
      expect(typeof lib.symbols.webkit_web_view_new).toBe('function');
      expect(typeof lib.symbols.webkit_web_view_load_uri).toBe('function');
      expect(typeof lib.symbols.webkit_web_view_load_html).toBe('function');
      expect(typeof lib.symbols.webkit_web_view_get_uri).toBe('function');
    });
  });
}

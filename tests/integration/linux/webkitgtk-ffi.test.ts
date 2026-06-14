import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { cstr } from '../../../src/main/platform/cstr';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { loadWebKitGtkFFI, readGetUriResult } from '../../../src/main/platform/linux/webkitgtk-ffi';

if (currentPlatform() === 'linux') {
  describe('WebKitGTK FFI on Linux', () => {
    test('resolves the core web-view symbols (proves the library + names are correct)', () => {
      const lib = loadWebKitGtkFFI();
      expect(typeof lib.symbols.webkit_web_view_new).toBe('function');
      expect(typeof lib.symbols.webkit_web_view_load_uri).toBe('function');
      expect(typeof lib.symbols.webkit_web_view_load_html).toBe('function');
      expect(typeof lib.symbols.webkit_web_view_get_uri).toBe('function');
    });

    test('resolves the navigation, JS-eval, and user-content symbols', () => {
      const lib = loadWebKitGtkFFI();
      for (const name of [
        'webkit_web_view_reload',
        'webkit_web_view_reload_bypass_cache',
        'webkit_web_view_go_back',
        'webkit_web_view_go_forward',
        'webkit_web_view_can_go_back',
        'webkit_web_view_can_go_forward',
        'webkit_web_view_evaluate_javascript',
        'webkit_web_view_get_user_content_manager',
        'webkit_user_content_manager_new',
        'webkit_user_content_manager_register_script_message_handler',
        'webkit_user_content_manager_add_script',
        'webkit_user_script_new',
        'webkit_web_view_get_type',
      ] as const) {
        expect(typeof lib.symbols[name]).toBe('function');
      }
    });

    // CI-RISK: webkit_web_view_get_type is the unverified void-arg get_type form.
    test('webkit_web_view_get_type returns a non-zero GType (BigInt)', () => {
      const lib = loadWebKitGtkFFI();
      const gtype = lib.symbols.webkit_web_view_get_type();
      expect(typeof gtype).toBe('bigint');
      expect(gtype).not.toBe(0n);
    });

    test('drives navigation + user-content symbols on a real web view', () => {
      const gtk = loadGtkFFI();
      if (gtk.symbols.gtk_init_check() === 0) {
        return; // No display.
      }
      const webkit = loadWebKitGtkFFI();

      // get_uri is NULL before any load -> readGetUriResult guards it to ''.
      const view = webkit.symbols.webkit_web_view_new();
      expect(view).not.toBeNull();
      expect(readGetUriResult(webkit.symbols.webkit_web_view_get_uri(view))).toBe('');

      // load_html with a NULL base_uri (pointer 0) must not crash.
      webkit.symbols.webkit_web_view_load_html(view, cstr('<!doctype html><title>t</title>'), null);

      // can_go_back/forward are gboolean (i32); false before any history.
      expect(webkit.symbols.webkit_web_view_can_go_back(view)).toBe(0);
      expect(webkit.symbols.webkit_web_view_can_go_forward(view)).toBe(0);

      // user-content-manager round-trip: create, register handler, add a script.
      const ucm = webkit.symbols.webkit_user_content_manager_new();
      expect(ucm).not.toBeNull();
      webkit.symbols.webkit_user_content_manager_register_script_message_handler(
        ucm,
        cstr('bunmaska'),
        null,
      );
      const script = webkit.symbols.webkit_user_script_new(cstr('void 0;'), 0, 0, null, null);
      expect(script).not.toBeNull();
      webkit.symbols.webkit_user_content_manager_add_script(ucm, script);

      // evaluate_javascript fire-and-forget (NULL callback) must not crash.
      webkit.symbols.webkit_web_view_evaluate_javascript(
        view,
        cstr('void 0;'),
        -1n,
        null,
        null,
        null,
        null,
        null,
      );
    });

    test('sets a custom User-Agent on a real view via WebKitSettings', () => {
      const gtk = loadGtkFFI();
      if (gtk.symbols.gtk_init_check() === 0) {
        return; // No display.
      }
      const webkit = loadWebKitGtkFFI();
      const view = webkit.symbols.webkit_web_view_new();
      const settings = webkit.symbols.webkit_web_view_get_settings(view);
      expect(settings).not.toBeNull();
      // Must resolve + not crash; the UA takes effect on the next navigation.
      expect(() =>
        webkit.symbols.webkit_settings_set_user_agent(settings, cstr('Bunmaska/1.0 (integration)')),
      ).not.toThrow();
    });

    test('readGetUriResult returns "" for a NULL pointer', () => {
      expect(readGetUriResult(null)).toBe('');
    });
  });
}

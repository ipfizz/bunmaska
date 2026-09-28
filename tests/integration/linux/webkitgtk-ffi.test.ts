import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { cstr } from '../../../src/main/platform/cstr';
import { loadGObjectFFI } from '../../../src/main/platform/linux/gobject-ffi';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { loadWebKitGtkFFI, readGetUriResult } from '../../../src/main/platform/linux/webkitgtk-ffi';

/** A WebKitWebView with no construct properties: g_object_new(type, NULL). */
const newWebView = () =>
  loadGObjectFFI().symbols.g_object_new(
    loadWebKitGtkFFI().symbols.webkit_web_view_get_type(),
    null,
    null,
    null,
  );

if (currentPlatform() === 'linux') {
  test('webkit_web_view_get_type returns a non-zero GType (BigInt)', () => {
    const gtype = loadWebKitGtkFFI().symbols.webkit_web_view_get_type();
    expect(typeof gtype).toBe('bigint');
    expect(gtype).not.toBe(0n);
  });

  const hasDisplay = loadGtkFFI().symbols.gtk_init_check() !== 0;

  describe.skipIf(!hasDisplay)('WebKitGTK FFI on a real display', () => {
    test('drives navigation + user-content symbols on a real web view', () => {
      const webkit = loadWebKitGtkFFI();

      // get_uri is NULL before any load -> readGetUriResult guards it to ''.
      const view = newWebView();
      expect(view).not.toBeNull();
      expect(readGetUriResult(webkit.symbols.webkit_web_view_get_uri(view))).toBe('');

      // load_html with a NULL base_uri must not crash.
      webkit.symbols.webkit_web_view_load_html(view, cstr('<!doctype html><title>t</title>'), null);

      // can_go_back/forward are gboolean (i32); false before any history.
      expect(webkit.symbols.webkit_web_view_can_go_back(view)).toBe(0);
      expect(webkit.symbols.webkit_web_view_can_go_forward(view)).toBe(0);

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
      webkit.symbols.webkit_user_script_unref(script);

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
      const webkit = loadWebKitGtkFFI();
      const settings = webkit.symbols.webkit_web_view_get_settings(newWebView());
      expect(settings).not.toBeNull();
      webkit.symbols.webkit_settings_set_user_agent(settings, cstr('Bunmaska/1.0 (integration)'));
    });
  });
}

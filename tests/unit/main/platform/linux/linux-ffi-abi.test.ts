import type { FFIType } from 'bun:ffi';
import { FFIType as T } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import {
  DBUS_CALL_TIMEOUT_MS,
  G_BUS_TYPE_SESSION,
  G_BUS_TYPE_SYSTEM,
  GDBUS_FFI_SYMBOLS,
  loadGDBusFFI,
} from '../../../../../src/main/platform/linux/gdbus-ffi';
import { GDK_FFI_SYMBOLS, loadGdkFFI } from '../../../../../src/main/platform/linux/gdk-ffi';
import { loadGdkPixbufFFI } from '../../../../../src/main/platform/linux/gdk-pixbuf-ffi';
import { GIO_FFI_SYMBOLS, loadGioFFI } from '../../../../../src/main/platform/linux/gio-ffi';
import { GLIB_FFI_SYMBOLS, loadGlibFFI } from '../../../../../src/main/platform/linux/glib-ffi';
import {
  GOBJECT_FFI_SYMBOLS,
  loadGObjectFFI,
} from '../../../../../src/main/platform/linux/gobject-ffi';
import {
  GTK_DIALOG_GOBJECT_FFI_SYMBOLS,
  loadGtkDialogFFI,
  loadGtkDialogGObjectFFI,
} from '../../../../../src/main/platform/linux/gtk-dialog-ffi';
import { GTK_FFI_SYMBOLS, loadGtkFFI } from '../../../../../src/main/platform/linux/gtk-ffi';
import { loadGMenuFFI, loadGtkMenuFFI } from '../../../../../src/main/platform/linux/gtk-menu-ffi';
import { JSC_FFI_SYMBOLS, loadJscFFI } from '../../../../../src/main/platform/linux/jsc-ffi';
import {
  LIBNOTIFY_FFI_SYMBOLS,
  loadLibnotifyFFI,
} from '../../../../../src/main/platform/linux/libnotify-ffi';
import { loadSoupFFI, SOUP_FFI_SYMBOLS } from '../../../../../src/main/platform/linux/soup-ffi';
import {
  loadWebKitGtkFFI,
  readGetUriResult,
  WEBKIT_LOAD_FINISHED,
  WEBKITGTK_FFI_SYMBOLS,
} from '../../../../../src/main/platform/linux/webkitgtk-ffi';

/**
 * The Linux FFI declarations that a reviewer would plausibly get WRONG. Restating a
 * signature that is legible three lines away in the source proves nothing, so this
 * file keeps only the C gotchas: gboolean's width, getters that must stay freeable
 * pointers, variadics pinned to one arity, scalar widths, and the constants whose
 * wrong value hangs or mis-dispatches at runtime.
 */

type Sym = { readonly args: readonly FFIType[]; readonly returns: FFIType };

/**
 * `gboolean` is a C `int`, not a C99 `_Bool`: declaring it as bun's `bool` reads a
 * single byte of a 4-byte value, so a TRUE from GTK can come back false.
 */
const GBOOLEAN_ARGS: ReadonlyArray<readonly [string, Sym, number]> = [
  ['gtk_widget_set_visible', GTK_FFI_SYMBOLS.gtk_widget_set_visible, 1],
  ['gtk_window_set_decorated', GTK_FFI_SYMBOLS.gtk_window_set_decorated, 1],
  ['gtk_window_set_resizable', GTK_FFI_SYMBOLS.gtk_window_set_resizable, 1],
];

const GBOOLEAN_RETURNS: ReadonlyArray<readonly [string, Sym]> = [
  ['gtk_window_is_maximized', GTK_FFI_SYMBOLS.gtk_window_is_maximized],
  ['gtk_window_is_active', GTK_FFI_SYMBOLS.gtk_window_is_active],
  ['gdk_clipboard_set_content', GDK_FFI_SYMBOLS.gdk_clipboard_set_content],
  ['notify_init', LIBNOTIFY_FFI_SYMBOLS.notify_init],
  ['notify_is_initted', LIBNOTIFY_FFI_SYMBOLS.notify_is_initted],
  ['notify_notification_show', LIBNOTIFY_FFI_SYMBOLS.notify_notification_show],
  ['notify_notification_close', LIBNOTIFY_FFI_SYMBOLS.notify_notification_close],
  ['soup_cookie_get_secure', SOUP_FFI_SYMBOLS.soup_cookie_get_secure],
  ['soup_cookie_get_http_only', SOUP_FFI_SYMBOLS.soup_cookie_get_http_only],
  [
    'webkit_cookie_manager_add_cookie_finish',
    WEBKITGTK_FFI_SYMBOLS.webkit_cookie_manager_add_cookie_finish,
  ],
  [
    'webkit_cookie_manager_delete_cookie_finish',
    WEBKITGTK_FFI_SYMBOLS.webkit_cookie_manager_delete_cookie_finish,
  ],
];

describe('gboolean is i32, never bool', () => {
  test.each(GBOOLEAN_ARGS)('%s takes gboolean as i32', (_name, sym, index) => {
    expect(sym.args[index]).toBe(T.i32);
    expect(sym.args[index]).not.toBe(T.bool);
  });

  test.each(GBOOLEAN_RETURNS)('%s returns gboolean as i32', (_name, sym) => {
    expect(sym.returns).toBe(T.i32);
    expect(sym.returns).not.toBe(T.bool);
  });
});

/**
 * A `cstring` return is decoded eagerly by bun and cannot be NULL-checked or freed.
 * These getters must stay raw pointers so the caller can guard 0 and, where the
 * transfer is full, hand the buffer back to g_free.
 */
const POINTER_GETTERS: ReadonlyArray<readonly [string, Sym]> = [
  ['gtk_window_get_title', GTK_FFI_SYMBOLS.gtk_window_get_title],
  ['webkit_web_view_get_uri', WEBKITGTK_FFI_SYMBOLS.webkit_web_view_get_uri],
  ['jsc_value_to_string', JSC_FFI_SYMBOLS.jsc_value_to_string],
  ['g_file_get_path', GIO_FFI_SYMBOLS.g_file_get_path],
  ['soup_cookie_get_name', SOUP_FFI_SYMBOLS.soup_cookie_get_name],
  ['soup_cookie_get_domain', SOUP_FFI_SYMBOLS.soup_cookie_get_domain],
];

describe('string getters return a guardable pointer, not cstring', () => {
  test.each(POINTER_GETTERS)('%s returns pointer', (_name, sym) => {
    expect(sym.returns).toBe(T.pointer);
    expect(sym.returns).not.toBe(T.cstring);
  });
});

/**
 * bun:ffi has no varargs: each of these C functions is variadic (or gained args
 * across an ABI break), so the declared arity IS the calling convention. Calling
 * with a different count corrupts the stack.
 */
const PINNED_ARITY: ReadonlyArray<readonly [string, Sym, number]> = [
  ['g_object_new (gobject-ffi, property form)', GOBJECT_FFI_SYMBOLS.g_object_new, 4],
  [
    'g_object_new (gtk-dialog-ffi, NULL-terminated form)',
    GTK_DIALOG_GOBJECT_FFI_SYMBOLS.g_object_new,
    2,
  ],
  [
    'webkit_web_view_evaluate_javascript (WK6.0)',
    WEBKITGTK_FFI_SYMBOLS.webkit_web_view_evaluate_javascript,
    8,
  ],
  [
    'webkit_user_content_manager_register_script_message_handler (WK6.0)',
    WEBKITGTK_FFI_SYMBOLS.webkit_user_content_manager_register_script_message_handler,
    3,
  ],
  ['g_dbus_connection_call_sync', GDBUS_FFI_SYMBOLS.g_dbus_connection_call_sync, 11],
];

describe('variadic / ABI-versioned functions are pinned to one arity', () => {
  test.each(PINNED_ARITY)('%s is pinned to one arity', (_name, sym, arity) => {
    expect(sym.args.length).toBe(arity);
  });

  test('the two g_object_new declarations stay distinct arities', () => {
    expect(GOBJECT_FFI_SYMBOLS.g_object_new.args.length).not.toBe(
      GTK_DIALOG_GOBJECT_FFI_SYMBOLS.g_object_new.args.length,
    );
  });
});

describe('width-sensitive scalars', () => {
  test('a GObject signal handler id is gulong (u64) on both sides', () => {
    expect(GOBJECT_FFI_SYMBOLS.g_signal_connect_data.returns).toBe(T.u64);
    expect(GOBJECT_FFI_SYMBOLS.g_signal_handler_disconnect.args[1]).toBe(T.u64);
  });

  test('a D-Bus subscription id is guint (u32) on both sides', () => {
    expect(GDBUS_FFI_SYMBOLS.g_dbus_connection_signal_subscribe.returns).toBe(T.u32);
    expect(GDBUS_FFI_SYMBOLS.g_dbus_connection_signal_unsubscribe.args[1]).toBe(T.u32);
  });

  test('webkit_uri_scheme_request_finish takes a 64-bit stream length', () => {
    expect(WEBKITGTK_FFI_SYMBOLS.webkit_uri_scheme_request_finish.args[2]).toBe(T.i64);
  });

  test('g_date_time_to_unix returns gint64 (i32 truncates post-2038 expirations)', () => {
    expect(GLIB_FFI_SYMBOLS.g_date_time_to_unix.returns).toBe(T.i64);
  });

  test('soup_cookie_new max_age is a C int (i32), not i64', () => {
    expect(SOUP_FFI_SYMBOLS.soup_cookie_new.args[4]).toBe(T.i32);
  });

  test('webkit_web_view_get_snapshot region/options are i32 enums, not pointers', () => {
    expect(WEBKITGTK_FFI_SYMBOLS.webkit_web_view_get_snapshot.args[1]).toBe(T.i32);
    expect(WEBKITGTK_FFI_SYMBOLS.webkit_web_view_get_snapshot.args[2]).toBe(T.i32);
  });
});

describe('constants that change runtime behaviour', () => {
  test('the D-Bus call timeout is a finite backstop, never the infinite G_MAXINT', () => {
    // The 4-hour CI hang: an unbounded sync call on a box with no session bus.
    expect(Number.isFinite(DBUS_CALL_TIMEOUT_MS)).toBe(true);
    expect(DBUS_CALL_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DBUS_CALL_TIMEOUT_MS).toBeLessThan(2_147_483_647);
  });

  test('the GBusType enum matches the C header', () => {
    expect(G_BUS_TYPE_SYSTEM).toBe(1);
    expect(G_BUS_TYPE_SESSION).toBe(2);
  });

  test('WEBKIT_LOAD_FINISHED is 3, not the last index of a 3-member enum', () => {
    expect(WEBKIT_LOAD_FINISHED).toBe(3);
  });

  test('readGetUriResult maps a NULL uri to the empty string', () => {
    expect(readGetUriResult(null)).toBe('');
  });
});

const LOADERS: ReadonlyArray<readonly [string, () => unknown]> = [
  ['loadGDBusFFI', loadGDBusFFI],
  ['loadGdkFFI', loadGdkFFI],
  ['loadGdkPixbufFFI', loadGdkPixbufFFI],
  ['loadGioFFI', loadGioFFI],
  ['loadGlibFFI', loadGlibFFI],
  ['loadGObjectFFI', loadGObjectFFI],
  ['loadGtkFFI', loadGtkFFI],
  ['loadGtkDialogFFI', loadGtkDialogFFI],
  ['loadGtkDialogGObjectFFI', loadGtkDialogGObjectFFI],
  ['loadGMenuFFI', loadGMenuFFI],
  ['loadGtkMenuFFI', loadGtkMenuFFI],
  ['loadJscFFI', loadJscFFI],
  ['loadLibnotifyFFI', loadLibnotifyFFI],
  ['loadWebKitGtkFFI', loadWebKitGtkFFI],
  ['loadSoupFFI', loadSoupFFI],
];

test.skipIf(currentPlatform() === 'linux')(
  'every Linux loader throws UnsupportedPlatformError off Linux',
  () => {
    const unguarded = LOADERS.filter(([, load]) => {
      try {
        load();
        return true;
      } catch (error) {
        return !(error instanceof UnsupportedPlatformError);
      }
    }).map(([name]) => name);

    expect(unguarded).toEqual([]);
  },
);

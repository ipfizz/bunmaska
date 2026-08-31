import type { Pointer } from 'bun:ffi';
import { toArrayBuffer } from 'bun:ffi';
import { loadGdkFFI } from './gdk-ffi';
import { loadGlibFFI } from './glib-ffi';
import { loadGObjectFFI } from './gobject-ffi';
import { runAsyncReady, withDeadline } from './gasync';
import {
  WEBKIT_SNAPSHOT_OPTIONS_NONE,
  WEBKIT_SNAPSHOT_REGION_VISIBLE,
  loadWebKitGtkFFI,
} from './webkitgtk-ffi';

/**
 * `webContents.capturePage` on Linux. WebKitGTK 6.0's snapshot returns a
 * `GdkTexture*`, NOT the 4.x `cairo_surface_t*` - treating it as a surface
 * corrupts the refcount and aborts in `cairo_surface_destroy` (a real CI
 * crash). PNG-encode via `gdk_texture_save_to_png_bytes` instead; no cairo.
 */

const RENDER_TIMEOUT_MS = 30_000;

export const capturePage = (view: Pointer): Promise<Uint8Array> => {
  const wk = loadWebKitGtkFFI().symbols;
  return withDeadline(
    runAsyncReady(
      (cb) =>
        wk.webkit_web_view_get_snapshot(
          view,
          WEBKIT_SNAPSHOT_REGION_VISIBLE,
          WEBKIT_SNAPSHOT_OPTIONS_NONE,
          null,
          cb,
          null,
        ),
      (result) => {
        const texture = wk.webkit_web_view_get_snapshot_finish(view, result, null);
        if (texture === null) {
          throw new Error('capturePage failed (webkit_web_view_get_snapshot returned no texture)');
        }
        const gobject = loadGObjectFFI().symbols;
        try {
          const bytes = loadGdkFFI().symbols.gdk_texture_save_to_png_bytes(texture);
          if (bytes === null) {
            throw new Error('capturePage failed (gdk_texture_save_to_png_bytes returned NULL)');
          }
          const glib = loadGlibFFI().symbols;
          try {
            const size = Number(glib.g_bytes_get_size(bytes));
            const data = glib.g_bytes_get_data(bytes, null);
            if (data === null || size === 0) {
              throw new Error('capturePage failed (empty PNG bytes)');
            }
            // Copy out before the GBytes is unreffed; toArrayBuffer BORROWS.
            return new Uint8Array(toArrayBuffer(data, 0, size)).slice();
          } finally {
            glib.g_bytes_unref(bytes);
          }
        } finally {
          gobject.g_object_unref(texture);
        }
      },
    ),
    RENDER_TIMEOUT_MS,
    'capturePage',
  );
};

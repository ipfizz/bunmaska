import { type Pointer, ptr } from 'bun:ffi';
import type { Point, RawDisplay, ScreenBackend } from '../../api/screen';
import { loadGdkFFI } from './gdk-ffi';
import { loadGioFFI } from './gio-ffi';
import { loadGObjectFFI } from './gobject-ffi';

/**
 * Linux display enumeration via GTK4's GdkMonitor model.
 *
 * `gdk_display_get_monitors(default)` returns a `GListModel*` of `GdkMonitor`
 * (owned by GDK — NOT unref'd). `g_list_model_get_n_items` gives the count and
 * `g_list_model_get_item(model, i)` returns a transfer-full `GdkMonitor*` that
 * MUST be `g_object_unref`'d after reading. Per monitor:
 * `gdk_monitor_get_geometry(monitor, GdkRectangle* out)` fills a 4 x i32
 * `[x, y, width, height]` buffer (allocated here as an `Int32Array(4)`), and
 * `gdk_monitor_get_scale_factor` gives the integer device-pixel scale.
 *
 * Unlike CoreGraphics on macOS, GdkMonitor geometry is a true OUT-param struct,
 * so all four geometry fields — including the multi-monitor ORIGIN — are exact.
 *
 * v1 LIMITATIONS (all documented):
 * - workArea == bounds: GTK4's GdkMonitor has no work-area / strut API, so the
 *   panel/dock inset is not excluded.
 * - id == index: GdkMonitor has no stable numeric id; the list index is used.
 * - primary == index 0: GTK4 removed the primary-monitor concept; the first
 *   enumerated monitor is treated as primary.
 * - rotation == 0, internal == false: GdkMonitor exposes neither a rotation
 *   angle nor a built-in-panel flag through a simple scalar getter.
 * - getCursorScreenPoint == {0,0}: the GTK4 pointer position needs a surface +
 *   seat + device, which this read-only enumeration backend does not hold.
 */

const readGeometry = (
  symbols: ReturnType<typeof loadGdkFFI>['symbols'],
  monitor: Pointer,
): { x: number; y: number; width: number; height: number } => {
  const rect = new Int32Array(4);
  symbols.gdk_monitor_get_geometry(monitor, ptr(rect));
  return { x: rect[0] ?? 0, y: rect[1] ?? 0, width: rect[2] ?? 0, height: rect[3] ?? 0 };
};

/** Enumerate connected monitors via the GdkMonitor GListModel. */
export const getDisplays = (): readonly RawDisplay[] => {
  const gdk = loadGdkFFI();
  const gio = loadGioFFI();
  const gobject = loadGObjectFFI();

  const display = gdk.symbols.gdk_display_get_default();
  if (display === null) {
    return [];
  }
  const model = gdk.symbols.gdk_display_get_monitors(display);
  if (model === null) {
    return [];
  }
  const count = gio.symbols.g_list_model_get_n_items(model);

  const displays: RawDisplay[] = [];
  for (let i = 0; i < count; i++) {
    const monitor = gio.symbols.g_list_model_get_item(model, i);
    if (monitor === null) {
      continue;
    }
    const geometry = readGeometry(gdk.symbols, monitor);
    const scaleFactor = gdk.symbols.gdk_monitor_get_scale_factor(monitor);
    gobject.symbols.g_object_unref(monitor);

    const bounds = { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
    displays.push({
      id: i,
      bounds,
      workArea: bounds,
      scaleFactor: scaleFactor >= 1 ? scaleFactor : 1,
      rotation: 0,
      internal: false,
      primary: i === 0,
    });
  }
  return displays;
};

/** GTK4 cursor position needs a seat/device; v1 returns {0,0} (documented). */
export const getCursorScreenPoint = (): Point => ({ x: 0, y: 0 });

/** The Linux screen backend the public `screen` API delegates to. */
export const gdkScreenBackend: ScreenBackend = {
  getDisplays,
  getCursorScreenPoint,
};

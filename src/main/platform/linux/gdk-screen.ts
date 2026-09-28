import { FFIType, type Pointer, ptr } from 'bun:ffi';
import type { Point, RawDisplay, ScreenBackend } from '../../api/screen';
import { dlopen } from '../dlopen';
import { loadGdkFFI } from './gdk-ffi';
import { loadGioFFI } from './gio-ffi';
import { loadGObjectFFI } from './gobject-ffi';

const loadFractionalScale = () =>
  dlopen('libgtk-4.so.1', {
    gdk_monitor_get_scale: { args: [FFIType.pointer], returns: FFIType.f64 },
  });

let fractionalScale: ReturnType<typeof loadFractionalScale> | null | undefined;

/** `gdk_monitor_get_scale` (GTK 4.14+) reports fractional scaling; older GTK has only the integer ceiling. */
const monitorScale = (monitor: Pointer, integerScale: number): number => {
  if (fractionalScale === undefined) {
    try {
      fractionalScale = loadFractionalScale();
    } catch {
      fractionalScale = null;
    }
  }
  return fractionalScale?.symbols.gdk_monitor_get_scale(monitor) ?? integerScale;
};

const readGeometry = (
  symbols: ReturnType<typeof loadGdkFFI>['symbols'],
  monitor: Pointer,
): { x: number; y: number; width: number; height: number } => {
  const rect = new Int32Array(4);
  symbols.gdk_monitor_get_geometry(monitor, ptr(rect));
  return { x: rect[0] ?? 0, y: rect[1] ?? 0, width: rect[2] ?? 0, height: rect[3] ?? 0 };
};

// ponytail: workArea = bounds, id = index, primary = index 0, rotation 0, internal false; GTK4 has no API for them.
export const getDisplays = (): readonly RawDisplay[] => {
  const gdk = loadGdkFFI();
  const gio = loadGioFFI();
  const gobject = loadGObjectFFI();

  const display = gdk.symbols.gdk_display_get_default();
  if (display === null) {
    return [];
  }
  // GDK owns the model: never unref it.
  const model = gdk.symbols.gdk_display_get_monitors(display);
  if (model === null) {
    return [];
  }
  const count = gio.symbols.g_list_model_get_n_items(model);

  const displays: RawDisplay[] = [];
  for (let i = 0; i < count; i++) {
    // transfer-full: unref after reading.
    const monitor = gio.symbols.g_list_model_get_item(model, i);
    if (monitor === null) {
      continue;
    }
    const geometry = readGeometry(gdk.symbols, monitor);
    const scaleFactor = monitorScale(monitor, gdk.symbols.gdk_monitor_get_scale_factor(monitor));
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

// ponytail: always {0,0}; the GTK4 pointer position needs a surface, seat and device.
export const getCursorScreenPoint = (): Point => ({ x: 0, y: 0 });

export const gdkScreenBackend: ScreenBackend = {
  getDisplays,
  getCursorScreenPoint,
};

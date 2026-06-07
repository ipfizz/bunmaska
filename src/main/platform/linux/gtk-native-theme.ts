import { ptr } from 'bun:ffi';
import { cstr } from '../cstr';
import { loadGObjectFFI } from './gobject-ffi';
import { loadGtkFFI } from './gtk-ffi';

/**
 * Linux appearance query.
 *
 * Reads the `gtk-application-prefer-dark-theme` boolean off the default
 * `GtkSettings` via `g_object_get` into a caller-allocated `gboolean` buffer —
 * the in-process GTK signal of the user's dark-mode preference. Pure read, no UI.
 */

const PREFER_DARK = 'gtk-application-prefer-dark-theme';

/** Whether the GTK desktop currently prefers a dark theme. */
export const shouldUseDarkColors = (): boolean => {
  const settings = loadGtkFFI().symbols.gtk_settings_get_default();
  if (settings === null) {
    return false;
  }
  const out = new Int32Array(1);
  loadGObjectFFI().symbols.g_object_get(settings, cstr(PREFER_DARK), ptr(out), null);
  return out[0] !== 0;
};

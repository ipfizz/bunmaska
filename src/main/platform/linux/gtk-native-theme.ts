import { type JSCallback, ptr } from 'bun:ffi';
import { cstr } from '../cstr';
import { loadGObjectFFI } from './gobject-ffi';
import { loadGtkFFI } from './gtk-ffi';
import { connectSignal, makeNotifyCallback } from './gtk-signals';

/**
 * Linux appearance query + change observer.
 *
 * Reads the `gtk-application-prefer-dark-theme` boolean off the default
 * `GtkSettings` via `g_object_get` into a caller-allocated `gboolean` buffer —
 * the in-process GTK signal of the user's dark-mode preference. Pure read, no UI.
 *
 * {@link observeAppearanceChange} connects to that property's `notify` signal so
 * `onChange` fires whenever the desktop's dark-mode preference flips.
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

// The settings object outlives the app, so the connection is permanent and its
// callback must stay reachable (else GObject jumps into a freed thunk).
const retainedThemeCallbacks: JSCallback[] = [];

/** Fire `onChange` whenever the GTK desktop's dark-theme preference flips. */
export const observeAppearanceChange = (onChange: () => void): void => {
  const settings = loadGtkFFI().symbols.gtk_settings_get_default();
  if (settings === null) {
    return;
  }
  const callback = makeNotifyCallback(onChange);
  connectSignal(settings, `notify::${PREFER_DARK}`, callback);
  retainedThemeCallbacks.push(callback);
};

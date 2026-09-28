import { type JSCallback, ptr } from 'bun:ffi';
import { cstr } from '../cstr';
import { loadGObjectFFI } from './gobject-ffi';
import { loadGtkFFI } from './gtk-ffi';
import { connectSignal, makeNotifyCallback } from './gtk-signals';

// Reads GtkSettings' app-level prefer-dark hint (settings.ini, KDE); GNOME keeps its dark style in the
// portal color-scheme. ponytail: read org.freedesktop.appearance color-scheme first (needs a session bus).

const PREFER_DARK = 'gtk-application-prefer-dark-theme';

export const shouldUseDarkColors = (): boolean => {
  const settings = loadGtkFFI().symbols.gtk_settings_get_default();
  if (settings === null) {
    return false;
  }
  const out = new Int32Array(1);
  loadGObjectFFI().symbols.g_object_get(settings, cstr(PREFER_DARK), ptr(out), null);
  return out[0] !== 0;
};

// The settings object outlives the app: its callbacks stay reachable forever, or GObject calls a freed thunk.
const retainedThemeCallbacks: JSCallback[] = [];

export const observeAppearanceChange = (onChange: () => void): void => {
  const settings = loadGtkFFI().symbols.gtk_settings_get_default();
  if (settings === null) {
    return;
  }
  const callback = makeNotifyCallback(onChange);
  connectSignal(settings, `notify::${PREFER_DARK}`, callback);
  retainedThemeCallbacks.push(callback);
};

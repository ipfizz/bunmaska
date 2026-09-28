import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cstr } from '../cstr';
import { loadGdkFFI } from './gdk-ffi';
import { loadGioFFI } from './gio-ffi';

/**
 * Desktop integration via GIO + GDK — the Linux half of Electron's `shell`.
 */

/** Open a URL in the default application. Returns whether the OS accepted it. */
export const openExternal = (url: string): boolean =>
  loadGioFFI().symbols.g_app_info_launch_default_for_uri(cstr(url), null, null) === 1;

/** Open a file or folder path with its default application. Returns success. */
export const openPath = (path: string): boolean =>
  loadGioFFI().symbols.g_app_info_launch_default_for_uri(
    cstr(pathToFileURL(path).href),
    null,
    null,
  ) === 1;

/**
 * Reveal a file or folder by opening its containing directory in the file
 * manager. Approximation: opens the parent folder; it does NOT select the item
 * (selecting requires the `org.freedesktop.FileManager1` DBus interface, out of
 * scope).
 */
export const showItemInFolder = (path: string): void => {
  loadGioFFI().symbols.g_app_info_launch_default_for_uri(
    cstr(pathToFileURL(dirname(path)).href),
    null,
    null,
  );
};

/** Play the system beep via the default GDK display (no-op if there is none). */
export const beep = (): void => {
  const gdk = loadGdkFFI().symbols;
  const display = gdk.gdk_display_get_default();
  if (display !== null) {
    gdk.gdk_display_beep(display);
  }
};

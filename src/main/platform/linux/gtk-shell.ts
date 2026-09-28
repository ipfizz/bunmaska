import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cstr } from '../cstr';
import { loadGdkFFI } from './gdk-ffi';
import { loadGioFFI } from './gio-ffi';

export const openExternal = (url: string): boolean =>
  loadGioFFI().symbols.g_app_info_launch_default_for_uri(cstr(url), null, null) === 1;

export const openPath = (path: string): boolean =>
  loadGioFFI().symbols.g_app_info_launch_default_for_uri(
    cstr(pathToFileURL(path).href),
    null,
    null,
  ) === 1;

// ponytail: opens the parent folder without selecting the item; selecting needs FileManager1.ShowItems over D-Bus.
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

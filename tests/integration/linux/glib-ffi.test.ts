import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadGDBusFFI } from '../../../src/main/platform/linux/gdbus-ffi';
import { loadGdkFFI } from '../../../src/main/platform/linux/gdk-ffi';
import { loadGdkPixbufFFI } from '../../../src/main/platform/linux/gdk-pixbuf-ffi';
import { loadGioFFI } from '../../../src/main/platform/linux/gio-ffi';
import { loadGlibFFI } from '../../../src/main/platform/linux/glib-ffi';
import { loadGObjectFFI } from '../../../src/main/platform/linux/gobject-ffi';
import {
  loadGtkDialogFFI,
  loadGtkDialogGObjectFFI,
} from '../../../src/main/platform/linux/gtk-dialog-ffi';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { loadGMenuFFI, loadGtkMenuFFI } from '../../../src/main/platform/linux/gtk-menu-ffi';
import { loadJscFFI } from '../../../src/main/platform/linux/jsc-ffi';
import { loadLibnotifyFFI } from '../../../src/main/platform/linux/libnotify-ffi';
import { loadLibsecretFFI } from '../../../src/main/platform/linux/libsecret-ffi';
import { loadSoupFFI } from '../../../src/main/platform/linux/soup-ffi';
import { loadWebKitGtkFFI } from '../../../src/main/platform/linux/webkitgtk-ffi';
import { loadX11FFI } from '../../../src/main/platform/linux/x11-ffi';

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
  ['loadLibsecretFFI', loadLibsecretFFI],
  ['loadSoupFFI', loadSoupFFI],
  ['loadWebKitGtkFFI', loadWebKitGtkFFI],
  ['loadX11FFI', loadX11FFI],
];

if (currentPlatform() === 'linux') {
  describe('Linux FFI loaders', () => {
    test('every loader dlopens and resolves its whole symbol table on this distro', () => {
      const failures = LOADERS.flatMap(([name, load]) => {
        try {
          load();
          return [];
        } catch (error) {
          return [`${name}: ${error instanceof Error ? error.message : String(error)}`];
        }
      });
      expect(failures).toEqual([]);
    });
  });
}

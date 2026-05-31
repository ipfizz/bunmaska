import { describe, expect, test } from 'bun:test';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import {
  beep,
  openExternal,
  openPath,
  pathToFileUri,
  showItemInFolder,
} from '../../../src/main/platform/linux/gtk-shell';

/**
 * Linux `shell` backend smoke test against a real GTK4/GDK display.
 *
 * Goal: the GIO/GDK symbols resolve and `beep()` runs on a live display
 * without crashing. We deliberately do NOT call `openExternal`/`openPath`/
 * `showItemInFolder`, which would actually launch a browser or file manager and
 * could hang or fail in CI. Runs only in CI ubuntu under `xvfb-run -a`; inert on
 * macOS via `describe.skipIf`.
 */

const isLinux = process.platform === 'linux';

describe.skipIf(!isLinux)('Linux shell backend', () => {
  test('exposes the ShellBackend-shaped methods', () => {
    expect(typeof openExternal).toBe('function');
    expect(typeof openPath).toBe('function');
    expect(typeof showItemInFolder).toBe('function');
    expect(typeof beep).toBe('function');
  });

  test('pathToFileUri builds an encoded file:// URI', () => {
    expect(pathToFileUri('/tmp/a b.txt')).toBe('file:///tmp/a%20b.txt');
  });

  test('beep() runs on a real GDK display without throwing', () => {
    // gtk_init_check initialises GDK so gdk_display_get_default() returns a
    // display; under Xvfb the bell is a no-op. Skip if there is no display.
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    expect(() => beep()).not.toThrow();
  });
});

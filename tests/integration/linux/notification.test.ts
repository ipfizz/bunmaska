import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { linuxNotificationBackend } from '../../../src/main/platform/linux/gtk-notification';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { loadLibnotifyFFI } from '../../../src/main/platform/linux/libnotify-ffi';

/**
 * Linux-only. Headless CI (xvfb) has NO notification daemon, so
 * `notify_notification_show` returns FALSE / no-ops there — that is EXPECTED and
 * NOT a failure. This test asserts only that:
 *   - every libnotify symbol resolves,
 *   - `notify_init('Sambar')` succeeds,
 *   - construct + show + close run WITHOUT THROWING.
 * It deliberately does NOT assert a banner appeared. A `gtk_init_check` guard
 * keeps the construct/show steps from running where there is no display at all.
 */
const isLinux = currentPlatform() === 'linux';

describe.skipIf(!isLinux)('libnotify FFI + Linux notification backend (Linux)', () => {
  test('loadLibnotifyFFI resolves every symbol without throwing', () => {
    const lib = loadLibnotifyFFI();
    for (const name of [
      'notify_init',
      'notify_is_initted',
      'notify_notification_new',
      'notify_notification_show',
      'notify_notification_close',
      'notify_notification_set_timeout',
    ] as const) {
      expect(typeof lib.symbols[name]).toBe('function');
    }
  });

  test('isSupported() runs notify_init and returns a boolean', () => {
    expect(typeof linuxNotificationBackend.isSupported()).toBe('boolean');
    // notify_init succeeding implies notify_is_initted is now TRUE.
    const lib = loadLibnotifyFFI();
    if (linuxNotificationBackend.isSupported()) {
      expect(lib.symbols.notify_is_initted()).not.toBe(0);
    }
  });

  test('construct + show + close run without throwing (no-daemon-safe)', () => {
    const gtk = loadGtkFFI();
    if (gtk.symbols.gtk_init_check() === 0) {
      return; // No display; symbol-resolution + init assertions above proved dispatch.
    }
    expect(() => {
      const handle = linuxNotificationBackend.present({
        title: 'Sambar test',
        body: 'Integration body',
        subtitle: '',
        silent: false,
      });
      handle.onClosed(() => undefined);
      handle.close();
    }).not.toThrow();
  });
});

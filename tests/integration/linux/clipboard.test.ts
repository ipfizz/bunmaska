import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { GDK_FFI_SYMBOLS, loadGdkFFI } from '../../../src/main/platform/linux/gdk-ffi';
import { GIO_FFI_SYMBOLS, loadGioFFI } from '../../../src/main/platform/linux/gio-ffi';
import { GLIB_FFI_SYMBOLS, loadGlibFFI } from '../../../src/main/platform/linux/glib-ffi';
import { linuxClipboardBackend } from '../../../src/main/platform/linux/gtk-clipboard';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { createLinuxDrain } from '../../../src/main/platform/linux/gtk-run-loop';

/**
 * Linux clipboard backend against a real GDK 4 clipboard under Xvfb.
 *
 * Unlike the dialog integration test (which can't simulate a user click), the
 * clipboard IS round-trip-testable headless: `writeText` installs a content
 * provider on the display's `GdkClipboard*` and `readText` reads it back IN THE
 * SAME PROCESS — no second selection owner required. The async read settles via
 * a `GAsyncReadyCallback`, so the GLib main context is pumped (`createLinuxDrain`)
 * while awaiting the Promise under a bounded deadline.
 *
 * Runs only in CI ubuntu under `xvfb-run -a`; inert on macOS via `describe.skipIf`.
 * Each test guards on `gtk_init_check()` so a display-less runner skips rather
 * than fails.
 */

const isLinux = currentPlatform() === 'linux';

/** A valid 1x1 PNG, round-tripped as raw `image/png` bytes (no NativeImage decode). */
const PNG_1x1 = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);

/** Yield to Bun's loop for `ms` while a setTimeout-deferred callback can fire. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Await `value` while cooperatively pumping the GLib main context so the GDK
 * read's `GAsyncReadyCallback` actually fires. HARD-BOUNDED by `budgetMs`: if the
 * promise has not settled by then it THROWS rather than awaiting forever — a slow
 * or stuck read fails the test fast instead of hanging the suite (the bug that
 * once let a deadlocked read run to CI's multi-hour cap). The `sleep` between
 * drains yields to the event loop so the async drain's chained reads + deferred
 * callback-closes can make forward progress.
 */
const awaitWithPump = async <T>(value: T | Promise<T>, budgetMs: number): Promise<T> => {
  const promise = Promise.resolve(value);
  const drain = createLinuxDrain();
  let done = false;
  void promise.finally(() => {
    done = true;
  });
  const step = 20;
  for (let waited = 0; waited < budgetMs && !done; waited += step) {
    drain();
    await sleep(step);
  }
  drain();
  if (!done) {
    // Never `return promise` here: an unsettled promise would await forever.
    throw new Error(`awaitWithPump: promise did not settle within ${budgetMs}ms`);
  }
  return promise;
};

describe.skipIf(!isLinux)('Linux clipboard backend (GDK 4)', () => {
  test('the GDK clipboard + content-provider and GLib GBytes symbols resolve', () => {
    const gdk = loadGdkFFI();
    for (const name of [
      'gdk_display_get_default',
      'gdk_display_get_clipboard',
      'gdk_clipboard_read_text_async',
      'gdk_clipboard_read_text_finish',
      'gdk_clipboard_set_content',
      'gdk_content_provider_new_for_bytes',
    ] as const) {
      expect(typeof gdk.symbols[name]).toBe('function');
      expect(name in GDK_FFI_SYMBOLS).toBe(true);
    }
    const glib = loadGlibFFI();
    for (const name of [
      'g_bytes_new',
      'g_bytes_unref',
      'g_bytes_get_size',
      'g_bytes_get_data',
    ] as const) {
      expect(typeof glib.symbols[name]).toBe('function');
      expect(name in GLIB_FFI_SYMBOLS).toBe(true);
    }
    for (const name of [
      'gdk_clipboard_read_async',
      'gdk_clipboard_read_finish',
      'gdk_clipboard_get_formats',
      'gdk_content_formats_to_string',
    ] as const) {
      expect(typeof gdk.symbols[name]).toBe('function');
      expect(name in GDK_FFI_SYMBOLS).toBe(true);
    }
    const gio = loadGioFFI();
    for (const name of [
      'g_input_stream_read_bytes_async',
      'g_input_stream_read_bytes_finish',
    ] as const) {
      expect(typeof gio.symbols[name]).toBe('function');
      expect(name in GIO_FFI_SYMBOLS).toBe(true);
    }
  });

  // Each async test carries a 15s bun:test deadline (third arg) on TOP of the 5s
  // awaitWithPump budget + 20m job ceiling — so a regression fails fast at every
  // layer instead of hanging.
  test('writeText then readText round-trips plain text in the same process', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return; // No display; the symbol-resolution test above already proved dispatch.
    }
    const value = 'bunmaska-clip-roundtrip-stable';
    linuxClipboardBackend.writeText(value);
    const got = await awaitWithPump(linuxClipboardBackend.readText(), 5000);
    expect(got).toBe(value);
  }, 15000);

  test('writeText replaces previous contents', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    linuxClipboardBackend.writeText('bunmaska-clip-first');
    linuxClipboardBackend.writeText('bunmaska-clip-second');
    const got = await awaitWithPump(linuxClipboardBackend.readText(), 5000);
    expect(got).toBe('bunmaska-clip-second');
  }, 15000);

  test('round-trips UTF-8 content', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    const value = 'café — 日本語 — 🎉';
    linuxClipboardBackend.writeText(value);
    const got = await awaitWithPump(linuxClipboardBackend.readText(), 5000);
    expect(got).toBe(value);
  }, 15000);

  test('clear then readText returns empty string', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    linuxClipboardBackend.writeText('bunmaska-clip-to-be-cleared');
    linuxClipboardBackend.clear();
    const got = await awaitWithPump(linuxClipboardBackend.readText(), 5000);
    expect(got).toBe('');
  }, 15000);

  test('writeHTML then readHTML round-trips markup in the same process', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    const markup = '<b>bold</b> &amp; <i>italic</i>';
    linuxClipboardBackend.writeHTML(markup);
    const got = await awaitWithPump(linuxClipboardBackend.readHTML(), 5000);
    expect(got).toBe(markup);
  }, 15000);

  test('round-trips UTF-8 HTML content', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    const markup = '<p>café — 日本語 — 🎉</p>';
    linuxClipboardBackend.writeHTML(markup);
    const got = await awaitWithPump(linuxClipboardBackend.readHTML(), 5000);
    expect(got).toBe(markup);
  }, 15000);

  test('readHTML on a cleared clipboard returns empty string (null-stream / no-format path)', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    linuxClipboardBackend.clear();
    const got = await awaitWithPump(linuxClipboardBackend.readHTML(), 5000);
    expect(got).toBe('');
  }, 15000);

  test('writeImage then readImage round-trips PNG bytes in the same process', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    linuxClipboardBackend.writeImage(PNG_1x1);
    const got = await awaitWithPump(linuxClipboardBackend.readImage(), 5000);
    expect(Array.from(got)).toEqual(Array.from(PNG_1x1));
  }, 15000);

  test('availableFormats reports image/png after writing an image', () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    linuxClipboardBackend.writeImage(PNG_1x1);
    expect(linuxClipboardBackend.availableFormats()).toContain('image/png');
  });
});

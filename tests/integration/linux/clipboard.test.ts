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

/** Yield to Bun's loop for `ms` while a setTimeout-deferred callback can fire. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Await `value` while cooperatively pumping the GLib main context so the GDK
 * read's `GAsyncReadyCallback` actually fires. Bounded by `budgetMs`.
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
    for (const name of ['gdk_clipboard_read_async', 'gdk_clipboard_read_finish'] as const) {
      expect(typeof gdk.symbols[name]).toBe('function');
      expect(name in GDK_FFI_SYMBOLS).toBe(true);
    }
    const gio = loadGioFFI();
    for (const name of ['g_input_stream_read_bytes', 'g_input_stream_close'] as const) {
      expect(typeof gio.symbols[name]).toBe('function');
      expect(name in GIO_FFI_SYMBOLS).toBe(true);
    }
  });

  test('writeText then readText round-trips plain text in the same process', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return; // No display; the symbol-resolution test above already proved dispatch.
    }
    const value = 'sambar-clip-roundtrip-stable';
    linuxClipboardBackend.writeText(value);
    const got = await awaitWithPump(linuxClipboardBackend.readText(), 5000);
    expect(got).toBe(value);
  });

  test('writeText replaces previous contents', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    linuxClipboardBackend.writeText('sambar-clip-first');
    linuxClipboardBackend.writeText('sambar-clip-second');
    const got = await awaitWithPump(linuxClipboardBackend.readText(), 5000);
    expect(got).toBe('sambar-clip-second');
  });

  test('round-trips UTF-8 content', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    const value = 'café — 日本語 — 🎉';
    linuxClipboardBackend.writeText(value);
    const got = await awaitWithPump(linuxClipboardBackend.readText(), 5000);
    expect(got).toBe(value);
  });

  test('clear then readText returns empty string', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    linuxClipboardBackend.writeText('sambar-clip-to-be-cleared');
    linuxClipboardBackend.clear();
    const got = await awaitWithPump(linuxClipboardBackend.readText(), 5000);
    expect(got).toBe('');
  });

  test('writeHTML then readHTML round-trips markup in the same process', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    const markup = '<b>bold</b> &amp; <i>italic</i>';
    linuxClipboardBackend.writeHTML(markup);
    const got = await awaitWithPump(linuxClipboardBackend.readHTML(), 5000);
    expect(got).toBe(markup);
  });

  test('round-trips UTF-8 HTML content', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    const markup = '<p>café — 日本語 — 🎉</p>';
    linuxClipboardBackend.writeHTML(markup);
    const got = await awaitWithPump(linuxClipboardBackend.readHTML(), 5000);
    expect(got).toBe(markup);
  });
});

import { CString, JSCallback, type Pointer, ptr, toArrayBuffer } from 'bun:ffi';
import type { ClipboardBackend } from '../../api/clipboard';
import { cstr } from '../cstr';
import { loadGdkFFI } from './gdk-ffi';
import { loadGioFFI } from './gio-ffi';
import { loadGlibFFI } from './glib-ffi';
import { loadGObjectFFI } from './gobject-ffi';

/**
 * Linux clipboard backend — the GDK 4 equivalent of the macOS `cocoa-clipboard`
 * module. The display's `GdkClipboard*` (from
 * `gdk_display_get_clipboard(gdk_display_get_default())`) owns plain-text
 * read/write against the system selection.
 *
 * Unlike Cocoa's synchronous `NSPasteboard stringForType:`, GDK's clipboard read
 * is asynchronous-only: `gdk_clipboard_read_text_async` kicks off the read and
 * invokes a `GAsyncReadyCallback` when it completes; `gdk_clipboard_read_text_finish`
 * extracts the transfer-full `char*` (NULL on empty/none). `readText` therefore
 * returns a Promise. Writes are synchronous: a `GdkContentProvider` wrapping the
 * UTF-8 bytes is installed via `gdk_clipboard_set_content` (a NULL provider
 * clears the clipboard).
 *
 * HTML uses the same write path with the `text/html` MIME. Reading HTML cannot
 * use the text-only `read_text` helper, so it goes through the general
 * `gdk_clipboard_read_async` (negotiating the `text/html` format) →
 * `gdk_clipboard_read_finish` (a transfer-full `GInputStream*`), which is then
 * drained synchronously chunk-by-chunk and UTF-8 decoded. The stream is local
 * and fully buffered, so the synchronous reads do not block the pump in practice.
 *
 * JSCallback lifecycle safety (a past SIGSEGV regression — mirrors gtk-dialog's
 * `runAsyncDialog`): the `GAsyncReadyCallback` thunk MUST stay reachable until
 * GDK fires it, and it MUST NOT be `close()`d synchronously inside its own
 * invocation (that frees the native trampoline the GDK caller is about to return
 * into). Each in-flight callback is retained in the module-level {@link inFlight}
 * set and its `close()` is deferred to a later tick via `setTimeout(..., 0)`.
 */

/** ABI shape for `GAsyncReadyCallback`: `(source, result, user_data) -> void`. */
export const CLIPBOARD_READ_CB_DEF = { args: ['ptr', 'ptr', 'ptr'], returns: 'void' } as const;

/** The MIME type GDK uses for UTF-8 plain text on the clipboard. */
const TEXT_MIME = 'text/plain;charset=utf-8';
/** The MIME type for HTML markup on the clipboard. */
const HTML_MIME = 'text/html';

/** Bytes per `g_input_stream_read_bytes` call when draining a clipboard stream. */
const STREAM_CHUNK_SIZE = 65536;
/** Hard cap on drain iterations — a runaway guard (≈ 1 GiB at the chunk size). */
const MAX_STREAM_CHUNKS = 16384;

/** Every JSCallback awaiting a GDK clipboard read. Retained so Bun can't GC it. */
const inFlight = new Set<JSCallback>();

/**
 * Per-read retained buffers for an HTML read: the `text/html\0` C string and the
 * `const char**` mime array handed to `gdk_clipboard_read_async`. Kept reachable
 * until the async read completes so Bun cannot GC the memory GDK is reading.
 */
const retainedReadBuffers = new Map<JSCallback, { mime: Uint8Array; mimeArray: BigUint64Array }>();

/** Resolve the display's `GdkClipboard*`, throwing if there is no default display. */
const getClipboard = (): Pointer => {
  const gdk = loadGdkFFI();
  const display = gdk.symbols.gdk_display_get_default();
  if (display === null) {
    throw new Error('gdk_display_get_default() returned null (no display / GTK not initialised)');
  }
  const clipboard = gdk.symbols.gdk_display_get_clipboard(display);
  if (clipboard === null) {
    throw new Error('gdk_display_get_clipboard() returned null');
  }
  return clipboard;
};

/** Settle inputs for `gdk_clipboard_read_text_finish`, with finish + reader injectable. */
export type SettleReadTextArgs = {
  readonly result: Pointer;
  /** Calls `gdk_clipboard_read_text_finish`; returns a `char*` or null; may throw. */
  readonly finish: (result: Pointer) => Pointer | null;
  /** Reads (and frees) the string out of a non-null `char*`. */
  readonly readString: (text: Pointer) => string;
};

/**
 * Produce the clipboard text from a `GAsyncResult`. A null `char*` (empty/none)
 * or a thrown `finish` (GError path) yields `''`. Pure but for the injected
 * functions, so it is unit-testable without a real clipboard.
 */
export const settleReadText = (args: SettleReadTextArgs): string => {
  let text: Pointer | null;
  try {
    text = args.finish(args.result);
  } catch {
    return '';
  }
  return text === null ? '' : args.readString(text);
};

/** Read the transfer-full `char*` into a JS string, then `g_free` it. */
const readGString = (text: Pointer): string => {
  const glib = loadGlibFFI();
  const value = new CString(text).toString();
  glib.symbols.g_free(text);
  return value;
};

/** One read + the final release of a `GInputStream`, abstracted for unit-testing. */
export type StreamReader = {
  /** Read up to `count` bytes; an empty result signals EOF (or an error). */
  read(count: number): Uint8Array;
  /** Close and release the stream. */
  close(): void;
};

/** Drain `reader` fully into a UTF-8 string (capped by {@link MAX_STREAM_CHUNKS}). */
export const drainStream = (reader: StreamReader): string => {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < MAX_STREAM_CHUNKS; i++) {
    const chunk = reader.read(STREAM_CHUNK_SIZE);
    if (chunk.length === 0) {
      break;
    }
    chunks.push(chunk);
    total += chunk.length;
  }
  reader.close();
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(out);
};

/** Settle inputs for `gdk_clipboard_read_finish`, with finish + drain injectable. */
export type SettleReadStreamArgs = {
  readonly result: Pointer;
  /** Calls `gdk_clipboard_read_finish`; returns a `GInputStream*` or null; may throw. */
  readonly finish: (result: Pointer) => Pointer | null;
  /** Drains a non-null `GInputStream*` to a string. */
  readonly drain: (stream: Pointer) => string;
};

/**
 * Produce the clipboard payload from a `GAsyncResult`. A null stream (no matching
 * format) or a thrown `finish` (GError path) yields `''`. Pure but for the
 * injected functions, so it is unit-testable without a real clipboard.
 */
export const settleReadStream = (args: SettleReadStreamArgs): string => {
  let stream: Pointer | null;
  try {
    stream = args.finish(args.result);
  } catch {
    return '';
  }
  return stream === null ? '' : args.drain(stream);
};

/** A {@link StreamReader} over a real GIO `GInputStream*` (transfer-full; unref on close). */
const realStreamReader = (stream: Pointer): StreamReader => {
  const gio = loadGioFFI();
  const glib = loadGlibFFI();
  return {
    read: (count) => {
      const gbytes = gio.symbols.g_input_stream_read_bytes(stream, BigInt(count), null, null);
      if (gbytes === null) {
        return new Uint8Array(0);
      }
      const size = Number(glib.symbols.g_bytes_get_size(gbytes));
      if (size === 0) {
        glib.symbols.g_bytes_unref(gbytes);
        return new Uint8Array(0);
      }
      const data = glib.symbols.g_bytes_get_data(gbytes, null);
      // Copy out of the GBytes-owned memory before dropping the ref.
      const copy =
        data === null ? new Uint8Array(0) : new Uint8Array(toArrayBuffer(data, 0, size)).slice();
      glib.symbols.g_bytes_unref(gbytes);
      return copy;
    },
    close: () => {
      gio.symbols.g_input_stream_close(stream, null, null);
      loadGObjectFFI().symbols.g_object_unref(stream);
    },
  };
};

const readText = (): Promise<string> => {
  const gdk = loadGdkFFI();
  const clipboard = getClipboard();
  return new Promise<string>((resolve) => {
    const callback = new JSCallback((_source: Pointer, result: Pointer, _userData: Pointer) => {
      const value = settleReadText({
        result,
        finish: (r) => gdk.symbols.gdk_clipboard_read_text_finish(clipboard, r, null),
        readString: readGString,
      });
      resolve(value);
      setTimeout(() => {
        inFlight.delete(callback);
        callback.close();
      }, 0);
    }, CLIPBOARD_READ_CB_DEF);
    inFlight.add(callback);
    const cbPtr = callback.ptr;
    if (cbPtr === null) {
      inFlight.delete(callback);
      throw new Error('Failed to allocate a GAsyncReadyCallback thunk for the clipboard read');
    }
    gdk.symbols.gdk_clipboard_read_text_async(clipboard, null, cbPtr, null);
  });
};

/** Install `text` on the clipboard under `mime` via a `GdkContentProvider`. */
const writeBytesAs = (mime: string, text: string): void => {
  const gdk = loadGdkFFI();
  const glib = loadGlibFFI();
  const clipboard = getClipboard();
  // Exact UTF-8 bytes (no trailing NUL — GBytes carries an explicit length).
  // `g_bytes_new` copies, so `bytes` need only outlive that call; keep it
  // referenced until then.
  const bytes = new TextEncoder().encode(text);
  const gbytes = glib.symbols.g_bytes_new(ptr(bytes), bytes.length);
  if (gbytes === null) {
    throw new Error('g_bytes_new() returned null');
  }
  const provider = gdk.symbols.gdk_content_provider_new_for_bytes(cstr(mime), gbytes);
  // The provider took its own ref on the GBytes; drop the local one. The provider
  // itself is owned by the clipboard once set_content takes a ref.
  glib.symbols.g_bytes_unref(gbytes);
  if (provider === null) {
    throw new Error('gdk_content_provider_new_for_bytes() returned null');
  }
  gdk.symbols.gdk_clipboard_set_content(clipboard, provider);
};

const writeText = (text: string): void => writeBytesAs(TEXT_MIME, text);

const writeHTML = (markup: string): void => writeBytesAs(HTML_MIME, markup);

const readHTML = (): Promise<string> => {
  const gdk = loadGdkFFI();
  const clipboard = getClipboard();
  return new Promise<string>((resolve) => {
    // NUL-terminated array of mime-type C strings: ["text/html", NULL].
    const mime = new TextEncoder().encode(`${HTML_MIME}\0`);
    const mimeArray = new BigUint64Array([BigInt(ptr(mime)), 0n]);
    const callback = new JSCallback((_source: Pointer, result: Pointer, _userData: Pointer) => {
      const value = settleReadStream({
        result,
        finish: (r) => gdk.symbols.gdk_clipboard_read_finish(clipboard, r, null, null),
        drain: (stream) => drainStream(realStreamReader(stream)),
      });
      resolve(value);
      setTimeout(() => {
        inFlight.delete(callback);
        retainedReadBuffers.delete(callback);
        callback.close();
      }, 0);
    }, CLIPBOARD_READ_CB_DEF);
    inFlight.add(callback);
    retainedReadBuffers.set(callback, { mime, mimeArray });
    const cbPtr = callback.ptr;
    if (cbPtr === null) {
      inFlight.delete(callback);
      retainedReadBuffers.delete(callback);
      throw new Error('Failed to allocate a GAsyncReadyCallback thunk for the clipboard HTML read');
    }
    gdk.symbols.gdk_clipboard_read_async(clipboard, ptr(mimeArray), 0, null, cbPtr, null);
  });
};

const clear = (): void => {
  const gdk = loadGdkFFI();
  const clipboard = getClipboard();
  gdk.symbols.gdk_clipboard_set_content(clipboard, null);
};

/** The Linux native clipboard backend (plain text + HTML via GDK 4). */
export const linuxClipboardBackend: ClipboardBackend = {
  readText,
  writeText,
  readHTML,
  writeHTML,
  clear,
};

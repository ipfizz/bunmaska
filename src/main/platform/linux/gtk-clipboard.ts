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
 * `gdk_clipboard_read_finish` (a transfer-full `GInputStream*`).
 *
 * DRAINING THE STREAM **ASYNCHRONOUSLY** is load-bearing. For an own-process
 * clipboard, GDK fulfils the read through an in-process `gdk_pipe_io_stream`
 * whose data is pushed by a writer `GTask` that ONLY runs when the GMainContext
 * iterates. A *synchronous* `g_input_stream_read_bytes` here would park on a
 * `g_cond_wait` for that writer while simultaneously freezing the one thread that
 * iterates the context → deadlock (this caused a multi-hour CI hang). So the
 * stream is drained with `g_input_stream_read_bytes_async` chunk-by-chunk: every
 * `await` yields control back to the pump, keeping the GMainContext free to feed
 * the pipe. Forward progress therefore requires the event loop to turn between
 * pump iterations (the app's CooperativePump and the test pump both yield) — this
 * MUST NOT be driven by a tight synchronous `g_main_context_iteration` loop.
 *
 * JSCallback lifecycle safety (a past SIGSEGV regression — mirrors gtk-dialog's
 * `runAsyncDialog`): every `GAsyncReadyCallback` thunk MUST stay reachable until
 * GDK fires it, and it MUST NOT be `close()`d synchronously inside its own
 * invocation (that frees the native trampoline the GDK caller is about to return
 * into). Each in-flight callback is retained in the module-level {@link inFlight}
 * set and `close()`d on a later tick via `setTimeout(..., 0)`. The HTML drain
 * allocates a FRESH one-shot callback per chunk (reads are strictly serial, so
 * there is never more than one in flight per stream — no `G_IO_ERROR_PENDING`).
 */

/** ABI shape for `GAsyncReadyCallback`: `(source, result, user_data) -> void`. */
export const CLIPBOARD_READ_CB_DEF = { args: ['ptr', 'ptr', 'ptr'], returns: 'void' } as const;

/** The MIME type GDK uses for UTF-8 plain text on the clipboard. */
const TEXT_MIME = 'text/plain;charset=utf-8';
/** The MIME type for HTML markup on the clipboard. */
const HTML_MIME = 'text/html';
/** The MIME type for PNG image data on the clipboard. */
const IMAGE_PNG_MIME = 'image/png';

/** Bytes per `g_input_stream_read_bytes_async` call when draining a clipboard stream. */
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

/** One ASYNC chunk read + the final release of a `GInputStream`, abstracted for unit-testing. */
export type AsyncStreamReader = {
  /** Resolve up to `count` bytes; an empty result signals EOF (or a swallowed error). */
  read(count: number): Promise<Uint8Array>;
  /** Release the stream (idempotent). */
  close(): void;
};

/**
 * Drain `reader` fully into a UTF-8 string (capped by {@link MAX_STREAM_CHUNKS}).
 * Strictly serial — awaits each read before issuing the next, so only one native
 * read is ever in flight. `reader.close()` runs in a `finally`, so the stream is
 * released on every terminal path (EOF, the cap, or a thrown read).
 */
export const drainStreamBytesAsync = async (reader: AsyncStreamReader): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (let i = 0; i < MAX_STREAM_CHUNKS; i++) {
      const chunk = await reader.read(STREAM_CHUNK_SIZE);
      if (chunk.length === 0) {
        break;
      }
      chunks.push(chunk);
      total += chunk.length;
    }
  } finally {
    reader.close();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

/**
 * Drain `reader` fully into a UTF-8 string (capped by {@link MAX_STREAM_CHUNKS}).
 * Concatenates bytes BEFORE decoding so a multibyte char split across a chunk
 * boundary still decodes correctly.
 */
export const drainStreamAsync = async (reader: AsyncStreamReader): Promise<string> =>
  new TextDecoder().decode(await drainStreamBytesAsync(reader));

/** Settle inputs for `gdk_clipboard_read_finish`, with finish + async drain injectable. */
export type SettleReadStreamArgs = {
  readonly result: Pointer;
  /** Calls `gdk_clipboard_read_finish`; returns a `GInputStream*` or null; may throw. */
  readonly finish: (result: Pointer) => Pointer | null;
  /** Drains a non-null `GInputStream*` to a string. */
  readonly drain: (stream: Pointer) => Promise<string>;
};

/**
 * Produce the clipboard payload from a `GAsyncResult`. A null stream (no matching
 * format) or a thrown `finish` (GError path) yields `''`. Pure but for the
 * injected functions, so it is unit-testable without a real clipboard.
 */
export const settleReadStreamAsync = async (args: SettleReadStreamArgs): Promise<string> => {
  let stream: Pointer | null;
  try {
    stream = args.finish(args.result);
  } catch {
    return '';
  }
  return stream === null ? '' : args.drain(stream);
};

/** Settle inputs for a binary `gdk_clipboard_read_finish`, draining to raw bytes. */
export type SettleReadStreamBytesArgs = {
  readonly result: Pointer;
  readonly finish: (result: Pointer) => Pointer | null;
  readonly drain: (stream: Pointer) => Promise<Uint8Array>;
};

/** Like {@link settleReadStreamAsync} but yields raw bytes (empty on no-match/error). */
export const settleReadStreamBytesAsync = async (
  args: SettleReadStreamBytesArgs,
): Promise<Uint8Array> => {
  let stream: Pointer | null;
  try {
    stream = args.finish(args.result);
  } catch {
    return new Uint8Array(0);
  }
  return stream === null ? new Uint8Array(0) : args.drain(stream);
};

/**
 * An {@link AsyncStreamReader} over a real GIO `GInputStream*` (transfer-full).
 *
 * Each `read` allocates a FRESH one-shot `GAsyncReadyCallback` (retained in
 * {@link inFlight}, closed on a deferred tick after its own invocation — never
 * synchronously), issues the non-blocking `g_input_stream_read_bytes_async`, and
 * resolves the chunk when the callback fires. `close` drops the transfer-full ref
 * with `g_object_unref` (GIO auto-closes the stream on its last unref — no
 * separate, potentially-blocking, synchronous close).
 */
const realAsyncStreamReader = (stream: Pointer): AsyncStreamReader => {
  const gio = loadGioFFI();
  const glib = loadGlibFFI();
  let closed = false;

  /** Read the chunk bytes out of a completed read's `GAsyncResult`, then unref the GBytes. */
  const finishChunk = (result: Pointer): Uint8Array => {
    const gbytes = gio.symbols.g_input_stream_read_bytes_finish(stream, result, null);
    if (gbytes === null) {
      return new Uint8Array(0); // GError → treat as EOF
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
  };

  return {
    read: (count) =>
      new Promise<Uint8Array>((resolve) => {
        const cb = new JSCallback((_src: Pointer, result: Pointer, _ud: Pointer) => {
          let chunk: Uint8Array = new Uint8Array(0);
          try {
            chunk = finishChunk(result);
          } catch {
            chunk = new Uint8Array(0);
          }
          resolve(chunk);
          // Deferred close: the read just returned INTO this trampoline.
          setTimeout(() => {
            inFlight.delete(cb);
            cb.close();
          }, 0);
        }, CLIPBOARD_READ_CB_DEF);
        inFlight.add(cb);
        const cbPtr = cb.ptr;
        if (cbPtr === null) {
          inFlight.delete(cb);
          resolve(new Uint8Array(0)); // allocation failure → EOF, ends the drain
          return;
        }
        gio.symbols.g_input_stream_read_bytes_async(stream, BigInt(count), 0, null, cbPtr, null);
      }),
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      // No explicit g_input_stream_close (it can block); GIO closes on last unref.
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

/** Install raw `bytes` on the clipboard under `mime` via a `GdkContentProvider`. */
const writeBytes = (mime: string, bytes: Uint8Array): void => {
  const gdk = loadGdkFFI();
  const glib = loadGlibFFI();
  const clipboard = getClipboard();
  // `g_bytes_new` copies, so `bytes` need only outlive that call.
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

/** Install `text` on the clipboard under `mime` (exact UTF-8 bytes, no trailing NUL). */
const writeBytesAs = (mime: string, text: string): void =>
  writeBytes(mime, new TextEncoder().encode(text));

const writeText = (text: string): void => writeBytesAs(TEXT_MIME, text);

const writeHTML = (markup: string): void => writeBytesAs(HTML_MIME, markup);

const writeImage = (png: Uint8Array): void => writeBytes(IMAGE_PNG_MIME, png);

const readHTML = (): Promise<string> => {
  const gdk = loadGdkFFI();
  const clipboard = getClipboard();
  return new Promise<string>((resolve) => {
    // NUL-terminated array of mime-type C strings: ["text/html", NULL].
    const mime = new TextEncoder().encode(`${HTML_MIME}\0`);
    const mimeArray = new BigUint64Array([BigInt(ptr(mime)), 0n]);
    const callback = new JSCallback((_source: Pointer, result: Pointer, _userData: Pointer) => {
      // The drain is async (yields to the pump between chunks); resolve when it
      // settles. This kickoff callback's own work is done synchronously here.
      void settleReadStreamAsync({
        result,
        finish: (r) => gdk.symbols.gdk_clipboard_read_finish(clipboard, r, null, null),
        drain: (stream) => drainStreamAsync(realAsyncStreamReader(stream)),
      }).then(resolve);
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

const readImage = (): Promise<Uint8Array> => {
  const gdk = loadGdkFFI();
  const clipboard = getClipboard();
  return new Promise<Uint8Array>((resolve) => {
    // NUL-terminated array of mime-type C strings: ["image/png", NULL].
    const mime = new TextEncoder().encode(`${IMAGE_PNG_MIME}\0`);
    const mimeArray = new BigUint64Array([BigInt(ptr(mime)), 0n]);
    const callback = new JSCallback((_source: Pointer, result: Pointer, _userData: Pointer) => {
      void settleReadStreamBytesAsync({
        result,
        finish: (r) => gdk.symbols.gdk_clipboard_read_finish(clipboard, r, null, null),
        drain: (stream) => drainStreamBytesAsync(realAsyncStreamReader(stream)),
      }).then(resolve);
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
      throw new Error(
        'Failed to allocate a GAsyncReadyCallback thunk for the clipboard image read',
      );
    }
    gdk.symbols.gdk_clipboard_read_async(clipboard, ptr(mimeArray), 0, null, cbPtr, null);
  });
};

/** The MIME types currently advertised by the clipboard (Electron's `availableFormats`). */
const availableFormats = (): string[] => {
  const gdk = loadGdkFFI();
  const glib = loadGlibFFI();
  const formats = gdk.symbols.gdk_clipboard_get_formats(getClipboard());
  if (formats === null) {
    return [];
  }
  const cstrPtr = gdk.symbols.gdk_content_formats_to_string(formats);
  if (cstrPtr === null) {
    return [];
  }
  const text = new CString(cstrPtr).toString();
  glib.symbols.g_free(cstrPtr);
  return text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

const clear = (): void => {
  const gdk = loadGdkFFI();
  const clipboard = getClipboard();
  gdk.symbols.gdk_clipboard_set_content(clipboard, null);
};

/** The Linux native clipboard backend (text + HTML + PNG images via GDK 4). */
export const linuxClipboardBackend: ClipboardBackend = {
  readText,
  writeText,
  readHTML,
  writeHTML,
  readImage,
  writeImage,
  availableFormats,
  clear,
};

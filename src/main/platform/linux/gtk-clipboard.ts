import { CString, JSCallback, type Pointer, ptr, toArrayBuffer } from 'bun:ffi';
import type { ClipboardBackend } from '../../api/clipboard';
import { cstr } from '../cstr';
import { GASYNC_READY_CB_DEF } from './gasync';
import { loadGdkFFI } from './gdk-ffi';
import { loadGioFFI } from './gio-ffi';
import { loadGlibFFI } from './glib-ffi';
import { loadGObjectFFI } from './gobject-ffi';

/**
 * GDK 4 clipboard. Stream reads MUST drain asynchronously (D033): an own-process read is fed by
 * a writer GTask that runs only when the pumped GMainContext iterates, so a synchronous read
 * deadlocks the one thread that could feed it (a multi-hour CI hang). Callback lifetime: gasync.ts.
 */

const TEXT_MIME = 'text/plain;charset=utf-8';
const HTML_MIME = 'text/html';
const IMAGE_PNG_MIME = 'image/png';

const STREAM_CHUNK_SIZE = 65536;
/** Runaway guard: about 1 GiB at the chunk size. */
const MAX_STREAM_CHUNKS = 16384;

/** Every callback GDK has yet to fire; Bun must not GC it first. */
const inFlight = new Set<JSCallback>();

/** A read's mime buffers, kept reachable past `gdk_clipboard_read_async` (which copies them). */
const retainedReadBuffers = new Map<JSCallback, { mime: Uint8Array; mimeArray: BigUint64Array }>();

/** Throws without a default display. */
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

export type SettleReadTextArgs = {
  readonly result: Pointer;
  /** Calls `gdk_clipboard_read_text_finish`; null when there is no text. */
  readonly finish: (result: Pointer) => Pointer | null;
  /** Reads, then frees, a non-null `char*`. */
  readonly readString: (text: Pointer) => string;
};

/** The clipboard text; `''` for a null `char*` or a throwing `finish`. */
export const settleReadText = (args: SettleReadTextArgs): string => {
  let text: Pointer | null;
  try {
    text = args.finish(args.result);
  } catch {
    return '';
  }
  return text === null ? '' : args.readString(text);
};

/** Reads, then `g_free`s, a transfer-full `char*`. */
const readGString = (text: Pointer): string => {
  const glib = loadGlibFFI();
  const value = new CString(text).toString();
  glib.symbols.g_free(text);
  return value;
};

/** Async chunk reads over one `GInputStream`. */
export type AsyncStreamReader = {
  /** Up to `count` bytes; an empty chunk is EOF (or a swallowed read error). */
  read(count: number): Promise<Uint8Array>;
  /** Idempotent. */
  close(): void;
};

/** Strictly serial, so only one native read is ever in flight; always closes the reader. */
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
  return Buffer.concat(chunks, total);
};

/** Decodes after concatenating, so a multibyte char split across two chunks survives. */
export const drainStreamAsync = async (reader: AsyncStreamReader): Promise<string> =>
  new TextDecoder().decode(await drainStreamBytesAsync(reader));

export type SettleReadStreamArgs<T> = {
  readonly result: Pointer;
  /** Calls `gdk_clipboard_read_finish`; null when no offered format matches. */
  readonly finish: (result: Pointer) => Pointer | null;
  readonly drain: (stream: Pointer) => Promise<T>;
  readonly empty: T;
};

/** The payload; `empty` for a null stream or a throwing `finish`. */
export const settleReadStream = async <T>(args: SettleReadStreamArgs<T>): Promise<T> => {
  let stream: Pointer | null;
  try {
    stream = args.finish(args.result);
  } catch {
    return args.empty;
  }
  return stream === null ? args.empty : args.drain(stream);
};

/** Takes a transfer-full `GInputStream*`; one fresh callback per chunk, never re-armed (D033). */
const realAsyncStreamReader = (stream: Pointer): AsyncStreamReader => {
  const gio = loadGioFFI();
  const glib = loadGlibFFI();
  let closed = false;

  const finishChunk = (result: Pointer): Uint8Array => {
    const gbytes = gio.symbols.g_input_stream_read_bytes_finish(stream, result, null);
    if (gbytes === null) {
      return new Uint8Array(0); // a failed read ends the drain like EOF
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
        }, GASYNC_READY_CB_DEF);
        inFlight.add(cb);
        const cbPtr = cb.ptr;
        if (cbPtr === null) {
          inFlight.delete(cb);
          resolve(new Uint8Array(0)); // allocation failure ends the drain like EOF
          return;
        }
        gio.symbols.g_input_stream_read_bytes_async(stream, BigInt(count), 0, null, cbPtr, null);
      }),
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      // The last unref closes the stream (g_input_stream_dispose).
      loadGObjectFFI().symbols.g_object_unref(stream);
    },
  };
};

const readText = (): Promise<string> =>
  new Promise<string>((resolve) => {
    const gdk = loadGdkFFI();
    const clipboard = getClipboard();
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
    }, GASYNC_READY_CB_DEF);
    inFlight.add(callback);
    const cbPtr = callback.ptr;
    if (cbPtr === null) {
      inFlight.delete(callback);
      throw new Error('Failed to allocate a GAsyncReadyCallback thunk for the clipboard read');
    }
    gdk.symbols.gdk_clipboard_read_text_async(clipboard, null, cbPtr, null);
  });

/** Install raw `bytes` on the clipboard under `mime` via a `GdkContentProvider`. */
const writeBytes = (mime: string, bytes: Uint8Array): void => {
  const gdk = loadGdkFFI();
  const glib = loadGlibFFI();
  const clipboard = getClipboard();
  // `g_bytes_new` copies, so `bytes` need only outlive that call.
  const gbytes = glib.symbols.g_bytes_new(bytes.length === 0 ? null : ptr(bytes), bytes.length);
  if (gbytes === null) {
    throw new Error('g_bytes_new() returned null');
  }
  const provider = gdk.symbols.gdk_content_provider_new_for_bytes(cstr(mime), gbytes);
  // The provider took its own ref on the GBytes.
  glib.symbols.g_bytes_unref(gbytes);
  if (provider === null) {
    throw new Error('gdk_content_provider_new_for_bytes() returned null');
  }
  // set_content takes its own ref; drop ours or every write leaks the provider and its payload.
  gdk.symbols.gdk_clipboard_set_content(clipboard, provider);
  loadGObjectFFI().symbols.g_object_unref(provider);
};

/** Install `text` on the clipboard under `mime` (exact UTF-8 bytes, no trailing NUL). */
const writeBytesAs = (mime: string, text: string): void =>
  writeBytes(mime, new TextEncoder().encode(text));

const writeText = (text: string): void => writeBytesAs(TEXT_MIME, text);

const writeHTML = (markup: string): void => writeBytesAs(HTML_MIME, markup);

const writeImage = (png: Uint8Array): void => writeBytes(IMAGE_PNG_MIME, png);

const readHTML = (): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const gdk = loadGdkFFI();
    const clipboard = getClipboard();
    // ["text/html", NULL]
    const mime = new TextEncoder().encode(`${HTML_MIME}\0`);
    const mimeArray = new BigUint64Array([BigInt(ptr(mime)), 0n]);
    const callback = new JSCallback((_source: Pointer, result: Pointer, _userData: Pointer) => {
      void settleReadStream({
        result,
        finish: (r) => gdk.symbols.gdk_clipboard_read_finish(clipboard, r, null, null),
        drain: (stream) => drainStreamAsync(realAsyncStreamReader(stream)),
        empty: '',
      }).then(resolve, reject);
      setTimeout(() => {
        inFlight.delete(callback);
        retainedReadBuffers.delete(callback);
        callback.close();
      }, 0);
    }, GASYNC_READY_CB_DEF);
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

const readImage = (): Promise<Uint8Array> =>
  new Promise<Uint8Array>((resolve, reject) => {
    const gdk = loadGdkFFI();
    const clipboard = getClipboard();
    // ["image/png", NULL]
    const mime = new TextEncoder().encode(`${IMAGE_PNG_MIME}\0`);
    const mimeArray = new BigUint64Array([BigInt(ptr(mime)), 0n]);
    const callback = new JSCallback((_source: Pointer, result: Pointer, _userData: Pointer) => {
      void settleReadStream({
        result,
        finish: (r) => gdk.symbols.gdk_clipboard_read_finish(clipboard, r, null, null),
        drain: (stream) => drainStreamBytesAsync(realAsyncStreamReader(stream)),
        empty: new Uint8Array(0),
      }).then(resolve, reject);
      setTimeout(() => {
        inFlight.delete(callback);
        retainedReadBuffers.delete(callback);
        callback.close();
      }, 0);
    }, GASYNC_READY_CB_DEF);
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

/** Electron-style MIME names from `gdk_content_formats_to_string` (GType names dropped). */
export const formatsFromGdk = (text: string): string[] => [
  ...new Set(
    text
      .split(/\s+/)
      .filter((token) => token.includes('/'))
      .map((mime) => mime.split(';')[0] as string),
  ),
];

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
  return formatsFromGdk(text);
};

const clear = (): void => {
  const gdk = loadGdkFFI();
  const clipboard = getClipboard();
  gdk.symbols.gdk_clipboard_set_content(clipboard, null);
};

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

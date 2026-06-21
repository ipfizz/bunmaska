import { ptr, toArrayBuffer } from 'bun:ffi';
import { FFIError, UnsupportedPlatformError } from '../../../common/errors';
import type { ClipboardBackend } from '../../api/clipboard';
import { wstr } from './win32';
import { loadKernel32, loadUser32 } from './win32-ffi';

/**
 * Windows clipboard backend (pure `bun:ffi`), the WinCairo peer of
 * `cocoa-clipboard.ts` / `gtk-clipboard.ts`. Text and HTML round-trip through the
 * flat Win32 clipboard API (`OpenClipboard`/`SetClipboardData`/... on user32 with
 * `GlobalAlloc`-backed transfer buffers on kernel32). Image read/write is not yet
 * implemented (DIB<->PNG conversion is a sizeable follow-up); those methods throw
 * rather than silently no-op, matching the public clipboard's stated contract.
 */

/** `CF_UNICODETEXT` — UTF-16LE text, the modern text clipboard format. */
const CF_UNICODETEXT = 13;
/** `CF_TEXT` — legacy ANSI text (read fallback only). */
const CF_TEXT = 1;
/** `CF_BITMAP`/`CF_DIB` — a device-(in)dependent bitmap is on the clipboard. */
const CF_BITMAP = 2;
const CF_DIB = 8;
/** `GMEM_MOVEABLE` — clipboard transfer buffers must be movable global memory. */
const GMEM_MOVEABLE = 0x0002;

/** The registered "HTML Format" clipboard format id, looked up once and cached. */
let htmlFormatId: number | undefined;
const cfHtmlFormat = (): number => {
  if (htmlFormatId === undefined) {
    htmlFormatId = loadUser32().symbols.RegisterClipboardFormatW(ptr(wstr('HTML Format')));
  }
  return htmlFormatId;
};

/** Pad an offset to the fixed 10-digit width CF_HTML headers conventionally use. */
const pad = (value: number): string => String(value).padStart(10, '0');

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

const FRAGMENT_START = '<!--StartFragment-->';
const FRAGMENT_END = '<!--EndFragment-->';

/**
 * Wrap HTML `markup` in a Windows CF_HTML payload: a UTF-8 document whose header
 * carries BYTE offsets (`StartHTML`/`EndHTML`/`StartFragment`/`EndFragment`) into
 * itself. Fixed-width offsets keep the header length constant, so the offsets can
 * be computed in one pass. Pure.
 */
export const buildCfHtml = (markup: string): string => {
  const header = (startHtml: number, endHtml: number, startFrag: number, endFrag: number): string =>
    `Version:0.9\r\nStartHTML:${pad(startHtml)}\r\nEndHTML:${pad(endHtml)}\r\n` +
    `StartFragment:${pad(startFrag)}\r\nEndFragment:${pad(endFrag)}\r\n`;
  const pre = `<html><body>\r\n${FRAGMENT_START}`;
  const post = `${FRAGMENT_END}\r\n</body></html>`;
  // The header's byte length is constant regardless of the (always 10-digit) values.
  const headerLength = byteLength(header(0, 0, 0, 0));
  const startHtml = headerLength;
  const startFragment = headerLength + byteLength(pre);
  const endFragment = startFragment + byteLength(markup);
  const endHtml = endFragment + byteLength(post);
  return `${header(startHtml, endHtml, startFragment, endFragment)}${pre}${markup}${post}`;
};

/**
 * Extract the HTML fragment from a CF_HTML payload via the standard
 * `<!--StartFragment-->`/`<!--EndFragment-->` markers (which browsers also emit),
 * falling back to the document body when they are absent. Pure.
 */
export const extractCfHtmlFragment = (cfHtml: string): string => {
  const start = cfHtml.indexOf(FRAGMENT_START);
  const end = cfHtml.indexOf(FRAGMENT_END);
  if (start !== -1 && end !== -1) {
    return cfHtml.slice(start + FRAGMENT_START.length, end);
  }
  const firstTag = cfHtml.indexOf('<');
  return firstTag === -1 ? '' : cfHtml.slice(firstTag);
};

/** Run `fn` while the clipboard is open, always closing it afterward. */
const withClipboard = <T>(fn: () => T): T => {
  const user32 = loadUser32().symbols;
  // OpenClipboard can briefly fail while another process holds it; retry a bounded
  // number of times rather than failing on a momentary clipboard-manager grab.
  let opened = false;
  for (let attempt = 0; attempt < 10 && !opened; attempt += 1) {
    opened = user32.OpenClipboard(0n) !== 0;
  }
  if (!opened) {
    throw new FFIError('clipboard: OpenClipboard failed (held by another process)');
  }
  try {
    return fn();
  } finally {
    user32.CloseClipboard();
  }
};

/** Copy `bytes` into a movable global block and hand it to the clipboard under `format`. */
const setClipboardBytes = (format: number, bytes: Uint8Array): void => {
  const kernel32 = loadKernel32().symbols;
  const user32 = loadUser32().symbols;
  const handle = kernel32.GlobalAlloc(GMEM_MOVEABLE, BigInt(bytes.length));
  if (handle === 0n) {
    throw new FFIError('clipboard: GlobalAlloc failed');
  }
  const dest = kernel32.GlobalLock(handle);
  if (dest === null) {
    kernel32.GlobalFree(handle);
    throw new FFIError('clipboard: GlobalLock failed');
  }
  new Uint8Array(toArrayBuffer(dest, 0, bytes.length)).set(bytes);
  kernel32.GlobalUnlock(handle);
  if (user32.SetClipboardData(format, handle) === 0n) {
    // Ownership did NOT transfer to the clipboard, so we must free the block.
    kernel32.GlobalFree(handle);
    throw new FFIError('clipboard: SetClipboardData failed');
  }
};

/** Read the clipboard data for `format` as raw bytes, or `undefined` if absent. */
const getClipboardBytes = (format: number): Uint8Array | undefined => {
  const kernel32 = loadKernel32().symbols;
  const user32 = loadUser32().symbols;
  if (user32.IsClipboardFormatAvailable(format) === 0) {
    return undefined;
  }
  const handle = user32.GetClipboardData(format);
  if (handle === 0n) {
    return undefined;
  }
  const source = kernel32.GlobalLock(handle);
  if (source === null) {
    return undefined;
  }
  const size = Number(kernel32.GlobalSize(handle));
  // Copy out of the clipboard-owned block before unlocking (we must not retain it).
  const bytes = new Uint8Array(toArrayBuffer(source, 0, size)).slice();
  kernel32.GlobalUnlock(handle);
  return bytes;
};

/** Decode UTF-16LE clipboard bytes, stopping at the first NUL code unit. */
const decodeUtf16 = (bytes: Uint8Array): string => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let result = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const unit = view.getUint16(i, true);
    if (unit === 0) {
      break; // NUL terminator — the rest is allocation padding.
    }
    result += String.fromCharCode(unit);
  }
  return result;
};

/** Decode UTF-8 clipboard bytes (CF_HTML), trimming a trailing NUL if present. */
const decodeUtf8 = (bytes: Uint8Array): string =>
  new TextDecoder().decode(bytes).replace(/\0[\s\S]*$/, '');

export const windowsClipboardBackend: ClipboardBackend = {
  readText(): string {
    return withClipboard(() => {
      const bytes = getClipboardBytes(CF_UNICODETEXT);
      return bytes === undefined ? '' : decodeUtf16(bytes);
    });
  },

  writeText(text: string): void {
    withClipboard(() => {
      loadUser32().symbols.EmptyClipboard();
      setClipboardBytes(CF_UNICODETEXT, wstr(text));
    });
  },

  readHTML(): string {
    return withClipboard(() => {
      const bytes = getClipboardBytes(cfHtmlFormat());
      return bytes === undefined ? '' : extractCfHtmlFragment(decodeUtf8(bytes));
    });
  },

  writeHTML(markup: string): void {
    withClipboard(() => {
      loadUser32().symbols.EmptyClipboard();
      setClipboardBytes(cfHtmlFormat(), new TextEncoder().encode(buildCfHtml(markup)));
    });
  },

  readImage(): Uint8Array {
    throw new UnsupportedPlatformError('clipboard image read is not yet implemented on Windows');
  },

  writeImage(): void {
    throw new UnsupportedPlatformError('clipboard image write is not yet implemented on Windows');
  },

  availableFormats(): string[] {
    return withClipboard(() => {
      const user32 = loadUser32().symbols;
      const has = (format: number): boolean => user32.IsClipboardFormatAvailable(format) !== 0;
      const formats: string[] = [];
      if (has(CF_UNICODETEXT) || has(CF_TEXT)) {
        formats.push('text/plain');
      }
      if (has(cfHtmlFormat())) {
        formats.push('text/html');
      }
      if (has(CF_DIB) || has(CF_BITMAP)) {
        formats.push('image/png');
      }
      return formats;
    });
  },

  clear(): void {
    withClipboard(() => {
      loadUser32().symbols.EmptyClipboard();
    });
  },
};

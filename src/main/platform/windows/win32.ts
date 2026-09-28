// Every Win32 handle (HWND, HMENU, HINSTANCE, ...) is a `bigint` declared `u64`, never
// `ptr`: pseudo-handles and sentinels such as (HWND)-1 exceed 2^53 and a Bun Pointer
// truncates them (the D029 hazard). Only real buffers (structs, strings) go through ptr().

import { type Pointer, ptr, read } from 'bun:ffi';
import { FFIError, UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import type { Rect } from '../native';

/** A NUL-terminated UTF-16LE `LPCWSTR`; the caller keeps it alive across the call. */
export const wstr = (input: string): Uint8Array => Buffer.from(`${input}\0`, 'utf16le');

/** Read a native `RECT` (left, top, right, bottom as LONGs) at `offset` as a {@link Rect}. */
export const readRect = (pointer: Pointer, offset: number): Rect => {
  const left = read.i32(pointer, offset);
  const top = read.i32(pointer, offset + 4);
  return {
    x: left,
    y: top,
    width: read.i32(pointer, offset + 8) - left,
    height: read.i32(pointer, offset + 12) - top,
  };
};

const WNDCLASSEXW_SIZE = 80;

/** Register a window class, throwing `FFIError` on failure; the name is copied into an atom. */
export const registerWindowClass = (
  user32: { readonly RegisterClassExW: (wc: Pointer) => number },
  name: string,
  wndProc: bigint,
  hInstance: bigint,
  hCursor = 0n,
): void => {
  const wc = new Uint8Array(WNDCLASSEXW_SIZE);
  const dv = new DataView(wc.buffer);
  dv.setUint32(0, WNDCLASSEXW_SIZE, true); // cbSize
  dv.setBigUint64(8, wndProc, true); // lpfnWndProc
  dv.setBigUint64(24, hInstance, true); // hInstance
  dv.setBigUint64(40, hCursor, true); // hCursor
  const className = wstr(name);
  dv.setBigUint64(64, BigInt(ptr(className)), true); // lpszClassName
  if (user32.RegisterClassExW(ptr(wc)) === 0) {
    throw new FFIError(`RegisterClassExW failed for ${name}`);
  }
};

/** Memoise `open` on first call; throws {@link UnsupportedPlatformError} off Windows. */
export const winLibraryAccessor = <T>(name: string, open: () => T): (() => T) => {
  let cached: T | undefined;
  return () => {
    if (currentPlatform() !== 'windows') {
      throw new UnsupportedPlatformError(`${name} is only supported on Windows`);
    }
    if (cached === undefined) {
      cached = open();
    }
    return cached;
  };
};

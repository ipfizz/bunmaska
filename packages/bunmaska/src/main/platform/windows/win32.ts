/**
 * Shared Win32 FFI primitives for the Windows backend.
 *
 * Mirrors `platform/macos/objc.ts` (D024): the place where the handle/string
 * conversions and the import-safe library loader live, so the window, message
 * pump, and per-subsystem FFI loaders never re-derive them.
 *
 * Every Win32 handle (`HWND`, `HMENU`, `HINSTANCE`, `HICON`, ...) flows through
 * the codebase as a `bigint` and crosses the FFI boundary as `u64`, NOT as a
 * Bun `Pointer`. A `HANDLE` is an opaque kernel value, not a virtual address, so
 * Bun's 52-bit pointer representation would corrupt its high bits — the same
 * truncation hazard the macOS backend avoids for tagged pointers (D029). Real
 * pointers (struct buffers, wide strings) are passed with `ptr()` as usual.
 */

import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/** Opaque pointer-width Win32 handle (`HWND`/`HMENU`/`HINSTANCE`/...). */
export type WinHandle = bigint;

/** The null Win32 handle (`NULL`). */
export const NULL_HANDLE: WinHandle = 0n;

/**
 * Encode a JS string as a null-terminated UTF-16LE byte sequence suitable for a
 * Win32 wide-character (`LPCWSTR`) argument — the `wstr` sibling of {@link cstr}.
 *
 * Modern Win32 and the WebKit C API are UTF-16; Windows is little-endian, and a
 * `WCHAR` is one UTF-16 code unit, so each `charCodeAt` unit is emitted as two
 * little-endian bytes (surrogate pairs become their two units) followed by a
 * 16-bit NUL. The caller pins the buffer (e.g. `ptr(wstr(s))`) for the call.
 */
export const wstr = (input: string): Uint8Array => {
  const terminated = `${input}\0`;
  const out = new Uint8Array(terminated.length * 2);
  for (let i = 0; i < terminated.length; i += 1) {
    const unit = terminated.charCodeAt(i);
    out[i * 2] = unit & 0xff;
    out[i * 2 + 1] = (unit >> 8) & 0xff;
  }
  return out;
};

/**
 * Build a memoising accessor for a Windows-only resource. The accessor opens the
 * resource on first call and caches it; it throws {@link UnsupportedPlatformError}
 * on any non-Windows host so importing modules stay safe to load everywhere.
 */
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

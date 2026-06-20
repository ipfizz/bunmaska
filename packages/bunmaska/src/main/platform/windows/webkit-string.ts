import { type Pointer, ptr } from 'bun:ffi';
import { FFIError } from '../../../common/errors';
import { cstr } from '../cstr';
import { loadWebKit2 } from './webkit2-ffi';

/**
 * `WKStringRef`/`WKURLRef` <-> JS string marshalling for the Windows backend,
 * the WinCairo peer of `cocoa-foundation.ts` (NSString) and the WebKitGTK JSC
 * value helpers. WK string objects are reference-counted: every `wk*` creator
 * here returns a +1 reference the caller must hand to {@link wkRelease}.
 */

/** Create a `WKStringRef` from a JS string. Caller releases it with {@link wkRelease}. */
export const wkString = (value: string): Pointer => {
  const ref = loadWebKit2().symbols.WKStringCreateWithUTF8CString(cstr(value));
  if (ref === null) {
    throw new FFIError('WKStringCreateWithUTF8CString returned NULL');
  }
  return ref;
};

/** Read a `WKStringRef` into a JS string (UTF-8). */
export const wkStringToJs = (ref: Pointer): string => {
  const wk = loadWebKit2();
  const size = Number(wk.symbols.WKStringGetMaximumUTF8CStringSize(ref));
  if (size <= 0) {
    return '';
  }
  const buffer = new Uint8Array(size);
  // Returns the byte count written INCLUDING the trailing NUL.
  const written = Number(wk.symbols.WKStringGetUTF8CString(ref, ptr(buffer), BigInt(size)));
  const length = written > 0 ? written - 1 : 0;
  return new TextDecoder().decode(buffer.subarray(0, length));
};

/** Create a `WKURLRef` from a URL string. Caller releases it with {@link wkRelease}. */
export const wkUrl = (value: string): Pointer => {
  const ref = loadWebKit2().symbols.WKURLCreateWithUTF8CString(cstr(value));
  if (ref === null) {
    throw new FFIError('WKURLCreateWithUTF8CString returned NULL');
  }
  return ref;
};

/** Copy a `WKURLRef` to a JS string, releasing the intermediate `WKStringRef`. */
export const wkUrlToJs = (urlRef: Pointer): string => {
  const stringRef = loadWebKit2().symbols.WKURLCopyString(urlRef);
  if (stringRef === null) {
    return '';
  }
  const value = wkStringToJs(stringRef);
  wkRelease(stringRef);
  return value;
};

/** Release a WK object (decrement its refcount). Null-safe. */
export const wkRelease = (ref: Pointer | null): void => {
  if (ref !== null) {
    loadWebKit2().symbols.WKRelease(ref);
  }
};

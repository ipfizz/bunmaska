import { cstr } from '../cstr';
import { ClassCache } from './cocoa-class-cache';
import { loadCocoaFFI } from './cocoa-ffi';
import { SelectorCache } from './cocoa-selector-cache';
import type { Handle } from './objc';

/**
 * The live Cocoa runtime — caches backed by the real `libobjc` symbols.
 *
 * Bunmaska uses {@link cocoa} as a process-wide singleton. The first call opens
 * `libobjc.A.dylib` + `Foundation.framework` via `bun:ffi`, builds the selector
 * and class caches with the live registrar / resolver, and returns the shared
 * runtime object. Subsequent calls return the same instance.
 *
 * Handles are exposed as `bigint` throughout Bunmaska (D016). The underlying FFI
 * declares the `id`/`SEL`/`Class` slots as `u64`, so Bun hands us full-precision
 * bigints directly — no `Pointer` round-trip and no tagged-pointer truncation
 * (D029).
 */
export type CocoaRuntime = {
  readonly selectors: SelectorCache;
  readonly classes: ClassCache;
  readonly msgSend: (receiver: Handle, selector: Handle) => Handle;
};

let cached: CocoaRuntime | undefined;

/**
 * Return the shared Cocoa runtime. Lazy — `libobjc` and `Foundation` are
 * opened on first call. Throws {@link UnsupportedPlatformError} (via
 * `loadCocoaFFI`) on any non-macOS platform.
 */
export const cocoa = (): CocoaRuntime => {
  if (cached !== undefined) {
    return cached;
  }

  const ffi = loadCocoaFFI();

  cached = {
    selectors: new SelectorCache((name) => ffi.symbols.sel_registerName(cstr(name))),
    classes: new ClassCache((name) => ffi.symbols.objc_getClass(cstr(name))),
    msgSend: (receiver, selector) => ffi.symbols.objc_msgSend(receiver, selector),
  };
  return cached;
};

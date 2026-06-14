import type { Pointer } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * Shared Objective-C FFI primitives for the macOS backend.
 *
 * Every Bunmaska Objective-C handle (`id`, `SEL`, `Class`, `IMP`) flows through
 * the codebase as a `bigint` (D016); the only place the `Pointer ↔ bigint`
 * conversion happens is here and at each `objc_msgSend` boundary. Centralising
 * these helpers keeps the runtime, the message-send variants, and the FFI
 * loaders from re-deriving the same conversions and library path.
 */

/** Opaque pointer-width Objective-C handle (`id`/`SEL`/`Class`/`IMP`). */
export type Handle = bigint;

/** Dynamic library name for the Objective-C runtime. */
export const LIBOBJC_PATH = 'libobjc.A.dylib';

/** Convert a `bigint` handle to the branded `Pointer` Bun FFI expects. */
export const ptrIn = (handle: Handle): Pointer => Number(handle) as Pointer;

/** Convert a `Pointer` (or `null`) returned by FFI to a `bigint` handle (`0n` for null). */
export const bigIntOut = (pointer: Pointer | null): Handle =>
  pointer === null ? 0n : BigInt(pointer);

/**
 * Build a memoising accessor for a macOS-only resource. The accessor opens the
 * resource on first call and caches it; it throws {@link UnsupportedPlatformError}
 * on any non-macOS host so importing modules stay safe to load everywhere.
 */
export const macOSLibraryAccessor = <T>(name: string, open: () => T): (() => T) => {
  let cached: T | undefined;
  return () => {
    if (currentPlatform() !== 'macos') {
      throw new UnsupportedPlatformError(`${name} is only supported on macOS`);
    }
    if (cached === undefined) {
      cached = open();
    }
    return cached;
  };
};

import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import { LIBOBJC_PATH } from './objc';

const FOUNDATION_PATH = '/System/Library/Frameworks/Foundation.framework/Foundation';
const APPKIT_PATH = '/System/Library/Frameworks/AppKit.framework/AppKit';

const FOUNDATION_SYMBOLS = {
  NSGetSizeAndAlignment: {
    args: [FFIType.cstring, FFIType.pointer, FFIType.pointer],
    returns: FFIType.cstring,
  },
};

const APPKIT_SYMBOLS = {
  NSApplicationMain: {
    args: [FFIType.i32, FFIType.pointer],
    returns: FFIType.i32,
  },
};

let foundationLib: unknown;
let appKitLib: unknown;

/**
 * Open `libobjc.A.dylib` plus `Foundation.framework` and expose the three
 * foundational Objective-C runtime symbols Bunmaska relies on:
 *
 * - `sel_registerName(const char *name) -> SEL`
 * - `objc_getClass(const char *name) -> Class`
 * - `objc_msgSend(id receiver, SEL selector) -> id` — the zero-extra-arg variant
 *
 * `objc_msgSend` is variadic in C; Bun's FFI cannot express that directly, so
 * we declare the simplest two-arg form here and add typed variants in later
 * modules as the call sites require them.
 *
 * Foundation + AppKit are loaded for the side-effect of registering their
 * classes (`NSString`, `NSWindow`, `NSApplication`, etc.) with the Objective-C
 * runtime so subsequent `objc_getClass(...)` calls resolve them. Bun requires
 * at least one symbol per `dlopen`, so we declare anchor symbols
 * (`NSGetSizeAndAlignment`, `NSApplicationMain`) without invoking them. The
 * handles are kept at module scope to prevent GC from closing the libraries.
 *
 * Only callable on macOS — throws {@link BunmaskaError} on any other platform so
 * that this module remains safely *importable* on Linux/Windows (the failure
 * happens at call time, not at module load).
 */
export const loadCocoaFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'macos') {
    throw new UnsupportedPlatformError(
      `loadCocoaFFI() is only supported on macOS; current platform is ${platform}`,
    );
  }

  if (foundationLib === undefined) {
    foundationLib = dlopen(FOUNDATION_PATH, FOUNDATION_SYMBOLS);
  }

  if (appKitLib === undefined) {
    appKitLib = dlopen(APPKIT_PATH, APPKIT_SYMBOLS);
  }

  // ObjC handles (id/SEL/Class) are declared u64, not pointer: tagged-pointer
  // objects (short NSString/NSNumber/NSDate) set high bits that exceed 2^53,
  // which FFIType.pointer would truncate to a corrupt f64. u64 preserves the
  // full 64-bit handle as a bigint. See D029.
  return dlopen(LIBOBJC_PATH, {
    sel_registerName: {
      args: [FFIType.cstring],
      returns: FFIType.u64,
    },
    objc_getClass: {
      args: [FFIType.cstring],
      returns: FFIType.u64,
    },
    objc_msgSend: {
      args: [FFIType.u64, FFIType.u64],
      returns: FFIType.u64,
    },
  });
};

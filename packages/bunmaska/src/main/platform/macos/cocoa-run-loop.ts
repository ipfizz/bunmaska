import { dlopen, FFIType } from 'bun:ffi';
import { cstr } from '../cstr';
import { bigIntOut, LIBOBJC_PATH, macOSLibraryAccessor, ptrIn } from './objc';

/**
 * macOS native run-loop drain.
 *
 * Provides the non-blocking "drain once" function the {@link CooperativePump}
 * calls each tick. It runs `CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0, true)`
 * repeatedly until the loop reports it has nothing left to handle, then
 * returns — the AppKit loop is serviced without ever blocking Bun's thread
 * (D020). Each drain is wrapped in an autorelease pool so per-event temporary
 * objects are released promptly.
 */

const CORE_FOUNDATION_PATH = '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation';

const K_CF_STRING_ENCODING_UTF8 = 0x08000100;

/** `CFRunLoopRunInMode` result codes (CFRunLoop.h). */
const CF_RUN_LOOP_RUN_HANDLED_SOURCE = 4;

/** Upper bound on inner drains per tick, so a busy loop can't starve Bun. */
const DRAIN_BUDGET = 256;

const getCoreFoundation = macOSLibraryAccessor('CoreFoundation run loop', () =>
  dlopen(CORE_FOUNDATION_PATH, {
    CFStringCreateWithCString: {
      args: [FFIType.pointer, FFIType.cstring, FFIType.u32],
      returns: FFIType.pointer,
    },
    CFRunLoopRunInMode: {
      args: [FFIType.pointer, FFIType.f64, FFIType.u8],
      returns: FFIType.i32,
    },
  }),
);

const getAutoreleasePool = macOSLibraryAccessor('libobjc autorelease pool', () =>
  dlopen(LIBOBJC_PATH, {
    objc_autoreleasePoolPush: { args: [], returns: FFIType.pointer },
    objc_autoreleasePoolPop: { args: [FFIType.pointer], returns: FFIType.void },
  }),
);

/**
 * Create the macOS drain function. Throws {@link UnsupportedPlatformError} on
 * any non-macOS host (via the lazy accessors). The returned function is cheap
 * to call repeatedly and never blocks.
 */
export const createMacOSDrain = (): (() => void) => {
  const cf = getCoreFoundation();
  const pool = getAutoreleasePool();
  const mode = bigIntOut(
    cf.symbols.CFStringCreateWithCString(
      null,
      cstr('kCFRunLoopDefaultMode'),
      K_CF_STRING_ENCODING_UTF8,
    ),
  );

  return () => {
    const poolToken = pool.symbols.objc_autoreleasePoolPush();
    try {
      for (let i = 0; i < DRAIN_BUDGET; i += 1) {
        const result = cf.symbols.CFRunLoopRunInMode(ptrIn(mode), 0, 1);
        if (result !== CF_RUN_LOOP_RUN_HANDLED_SOURCE) {
          break;
        }
      }
    } finally {
      pool.symbols.objc_autoreleasePoolPop(poolToken);
    }
  };
};

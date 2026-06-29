import { dlopen, FFIType } from 'bun:ffi';
import { cstr } from '../cstr';
import { bigIntOut, LIBOBJC_PATH, macOSLibraryAccessor, ptrIn } from './objc';

/**
 * macOS native run-loop drain.
 *
 * Returns a function the {@link AdaptiveBlockingPump} calls each tick with a
 * timeout: it dispatches pending AppKit input events (via `pumpEvents`), then
 * sleeps in `CFRunLoopRunInMode(kCFRunLoopDefaultMode, timeout, true)` until a
 * native source is handled or the timeout elapses. A UI event returns it
 * immediately (returnAfterSourceHandled), so the thread sleeps when idle yet
 * wakes the instant input arrives. Returns whether a source was handled — the
 * pump stays responsive while that holds and backs off when it doesn't. Each
 * drain runs inside an autorelease pool so per-tick temporaries are released.
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
export const createMacOSDrain = (pumpEvents?: () => void): ((timeoutMs: number) => boolean) => {
  const cf = getCoreFoundation();
  const pool = getAutoreleasePool();
  const mode = bigIntOut(
    cf.symbols.CFStringCreateWithCString(
      null,
      cstr('kCFRunLoopDefaultMode'),
      K_CF_STRING_ENCODING_UTF8,
    ),
  );

  return (timeoutMs: number) => {
    const poolToken = pool.symbols.objc_autoreleasePoolPush();
    try {
      pumpEvents?.();
      const handled =
        cf.symbols.CFRunLoopRunInMode(ptrIn(mode), timeoutMs / 1000, 1) ===
        CF_RUN_LOOP_RUN_HANDLED_SOURCE;
      if (handled) {
        // Dispatch the event that woke us, then clear any other ready sources
        // without blocking so a burst is handled in this tick.
        pumpEvents?.();
        for (let i = 0; i < DRAIN_BUDGET; i += 1) {
          if (cf.symbols.CFRunLoopRunInMode(ptrIn(mode), 0, 1) !== CF_RUN_LOOP_RUN_HANDLED_SOURCE) {
            break;
          }
        }
      }
      return handled;
    } finally {
      pool.symbols.objc_autoreleasePoolPop(poolToken);
    }
  };
};

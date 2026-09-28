import { FFIType, type Pointer } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { cstr } from '../cstr';
import { bigIntOut, LIBOBJC_PATH, macOSLibraryAccessor, ptrIn } from './objc';

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

/** Run `fn` in its own autorelease pool, releasing what it autoreleased when it returns. */
export const withAutoreleasePool = <T>(fn: () => T): T => {
  const pool = getAutoreleasePool();
  const token = pool.symbols.objc_autoreleasePoolPush();
  try {
    return fn();
  } finally {
    pool.symbols.objc_autoreleasePoolPop(token);
  }
};

// Bun's thread has no ambient pool, so everything JS autoreleases between ticks
// lands in this rolling pool, which each tick drains the way NSApp drains one pool
// per event. One token for every drain: a per-drain token is popped by another
// drain's tick first, and popping it again is an objc fatal abort.
let jsPool: Pointer | null | undefined;

/**
 * The macOS drain for AdaptiveBlockingPump (D047). It blocks in CFRunLoopRunInMode
 * for up to `timeoutMs`, returns early once a source is handled, and reports
 * whether one was. Throws UnsupportedPlatformError off macOS.
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

  jsPool ??= pool.symbols.objc_autoreleasePoolPush();
  return (timeoutMs: number) => {
    if (jsPool !== undefined) {
      pool.symbols.objc_autoreleasePoolPop(jsPool);
    }
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
      jsPool = pool.symbols.objc_autoreleasePoolPush();
    }
  };
};

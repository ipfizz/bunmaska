import { FFIType, type Pointer } from 'bun:ffi';
import { FFIError, UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import { cstr } from '../cstr';
import { dlopen } from '../dlopen';

/** An Objective-C `id`/`SEL`/`Class`/`IMP`: always a bigint (D016) in a u64 slot (D029). */
export type Handle = bigint;

export const LIBOBJC_PATH = 'libobjc.A.dylib';

const MAX_EXACT_POINTER = BigInt(Number.MAX_SAFE_INTEGER);

/** Convert a real C pointer to a `Pointer`; throws on a tagged or too-wide handle (D029). */
export const ptrIn = (handle: Handle): Pointer => {
  if (handle > MAX_EXACT_POINTER) {
    throw new FFIError(`ptrIn: 0x${handle.toString(16)} does not fit a JS number (tagged?)`);
  }
  return Number(handle) as Pointer;
};

/** Convert a `Pointer` (or `null`) returned by FFI to a `bigint` handle (`0n` for null). */
export const bigIntOut = (pointer: Pointer | null): Handle =>
  pointer === null ? 0n : BigInt(pointer);

/**
 * Run JS that native code called. A throw must never unwind through native frames
 * (Bun then skips every later JSCallback in that native call), so it is rethrown on
 * a microtask as an ordinary uncaught exception and `fallback` goes back to native.
 */
const rethrowLater = (error: unknown): void => {
  queueMicrotask(() => {
    throw error;
  });
};
let reportNativeError = rethrowLater;

export const callFromNative = <T>(fallback: T, run: () => T): T => {
  try {
    return run();
  } catch (error) {
    reportNativeError(error);
    return fallback;
  }
};

/** Capture errors {@link callFromNative} would rethrow; `undefined` restores the rethrow. Test-only. */
export const setNativeErrorReporterForTesting = (
  report: ((error: unknown) => void) | undefined,
): void => {
  reportNativeError = report ?? rethrowLater;
};

/** Memoise a macOS-only resource; throws {@link UnsupportedPlatformError} at call time elsewhere. */
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

const RTLD_NOW = 2;

const loadDl = macOSLibraryAccessor('libSystem dlsym', () =>
  dlopen('/usr/lib/libSystem.B.dylib', {
    dlopen: { args: [FFIType.cstring, FFIType.i32], returns: FFIType.pointer },
    dlsym: { args: [FFIType.pointer, FFIType.cstring], returns: FFIType.pointer },
  }),
);

/** The address of data symbol `name` in the image at `path`: bun's dlopen binds only functions. */
export const dataSymbolAddress = (path: string, name: string): Pointer => {
  const dl = loadDl().symbols;
  const image = dl.dlopen(cstr(path), RTLD_NOW);
  if (image === null) {
    throw new FFIError(`dlopen('${path}') failed`);
  }
  const address = dl.dlsym(image, cstr(name));
  if (address === null) {
    throw new FFIError(`dlsym('${name}') in ${path} returned null`);
  }
  return address;
};

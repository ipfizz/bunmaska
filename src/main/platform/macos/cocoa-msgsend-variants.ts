import { type Pointer, dlopen, FFIType } from 'bun:ffi';
import { SambarError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * Typed `objc_msgSend` variants for selectors whose signatures don't match
 * the zero-extra-arg form exposed on {@link CocoaRuntime}.
 *
 * Bun's FFI cannot declare two distinct signatures for the same symbol name
 * inside one `dlopen` call, so each variant `dlopen`s `libobjc.A.dylib` again
 * with a different signature. dyld dedupes the underlying image; the cost is
 * one extra `Library` wrapper object per variant.
 */

const LIBOBJC_PATH = 'libobjc.A.dylib';

/**
 * Returns an accessor that lazily opens a macOS-only library and caches the
 * resulting handle. The accessor throws {@link SambarError} on any non-macOS
 * host. Used to factor out the platform-check + lazy-`dlopen` pattern shared
 * by every variant in this module.
 */
const macOSLibraryAccessor = <T>(name: string, open: () => T): (() => T) => {
  let cached: T | undefined;
  return () => {
    if (currentPlatform() !== 'macos') {
      throw new SambarError(`${name} is only supported on macOS`);
    }
    if (cached === undefined) {
      cached = open();
    }
    return cached;
  };
};

const INIT_WITH_CONTENT_RECT_VARIANT = {
  objc_msgSend: {
    args: [
      FFIType.pointer,
      FFIType.pointer,
      FFIType.f64,
      FFIType.f64,
      FFIType.f64,
      FFIType.f64,
      FFIType.u64,
      FFIType.u64,
      FFIType.u8,
    ],
    returns: FFIType.pointer,
  },
} as const;

const PTR_VARIANT = {
  objc_msgSend: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.pointer,
  },
} as const;

const U8_VARIANT = {
  objc_msgSend: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.u8],
    returns: FFIType.pointer,
  },
} as const;

const F64_VARIANT = {
  objc_msgSend: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.f64],
    returns: FFIType.pointer,
  },
} as const;

const I64_VARIANT = {
  objc_msgSend: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.i64],
    returns: FFIType.pointer,
  },
} as const;

const getInitWithContentRectLib = macOSLibraryAccessor('msgSendInitWithContentRect', () =>
  dlopen(LIBOBJC_PATH, INIT_WITH_CONTENT_RECT_VARIANT),
);

const getPtrLib = macOSLibraryAccessor('msgSendPtr', () => dlopen(LIBOBJC_PATH, PTR_VARIANT));

const getU8Lib = macOSLibraryAccessor('msgSendU8', () => dlopen(LIBOBJC_PATH, U8_VARIANT));

const getF64Lib = macOSLibraryAccessor('msgSendF64', () => dlopen(LIBOBJC_PATH, F64_VARIANT));

const getI64Lib = macOSLibraryAccessor('msgSendI64', () => dlopen(LIBOBJC_PATH, I64_VARIANT));

const ptrIn = (n: bigint): Pointer => Number(n) as Pointer;
const bigIntOut = (p: Pointer | null): bigint => (p === null ? 0n : BigInt(p));

export type CGRectArgs = readonly [x: number, y: number, width: number, height: number];

/**
 * Send `initWithContentRect:styleMask:backing:defer:` to an NSWindow receiver.
 *
 * On both macOS ABIs (ARM64 and x86_64 SysV) a `CGRect` (struct of four
 * `double`s) is passed in exactly the same registers as four separate `double`
 * args. So this variant declares `objc_msgSend` with raw f64×4 in place of the
 * CGRect struct — no C shim required.
 *
 * Only callable on macOS — throws {@link SambarError} otherwise.
 */
export const msgSendInitWithContentRect = (
  receiver: bigint,
  selector: bigint,
  rect: CGRectArgs,
  styleMask: bigint,
  backing: bigint,
  defer: boolean,
): bigint => {
  const lib = getInitWithContentRectLib();
  const result = lib.symbols.objc_msgSend(
    ptrIn(receiver),
    ptrIn(selector),
    rect[0],
    rect[1],
    rect[2],
    rect[3],
    styleMask,
    backing,
    defer ? 1 : 0,
  );
  return bigIntOut(result);
};

/**
 * Send a message with one extra pointer-sized arg, e.g.
 * `[receiver setTitle:nsstring]`, `[receiver makeKeyAndOrderFront:nil]`,
 * `[receiver performSelector:sel]`.
 *
 * Only callable on macOS — throws {@link SambarError} otherwise.
 */
export const msgSendPtr = (receiver: bigint, selector: bigint, arg: bigint): bigint => {
  const lib = getPtrLib();
  const result = lib.symbols.objc_msgSend(ptrIn(receiver), ptrIn(selector), ptrIn(arg));
  return bigIntOut(result);
};

/**
 * Send a message with one extra `u8` arg, e.g.
 * `[NSApp activateIgnoringOtherApps:YES]`, `[window setReleasedWhenClosed:NO]`,
 * `[NSNumber numberWithBool:YES]`. Pass `0` or `1` for the boolean.
 *
 * Only callable on macOS — throws {@link SambarError} otherwise.
 */
export const msgSendU8 = (receiver: bigint, selector: bigint, arg: number): bigint => {
  const lib = getU8Lib();
  const result = lib.symbols.objc_msgSend(ptrIn(receiver), ptrIn(selector), arg);
  return bigIntOut(result);
};

/**
 * Send a message with one extra `double` arg, e.g.
 * `[NSDate dateWithTimeIntervalSinceNow:0.5]` or
 * `[NSTimer scheduledTimerWithTimeInterval:...]` (with appropriate variants).
 *
 * Only callable on macOS — throws {@link SambarError} otherwise.
 */
export const msgSendF64 = (receiver: bigint, selector: bigint, arg: number): bigint => {
  const lib = getF64Lib();
  const result = lib.symbols.objc_msgSend(ptrIn(receiver), ptrIn(selector), arg);
  return bigIntOut(result);
};

/**
 * Send a message with one extra `int64_t` (signed) arg — used for `NSInteger`
 * params on 64-bit macOS, e.g.
 * `[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular]`,
 * `[NSNumber numberWithInteger:n]`.
 *
 * Only callable on macOS — throws {@link SambarError} otherwise.
 */
export const msgSendI64 = (receiver: bigint, selector: bigint, arg: bigint): bigint => {
  const lib = getI64Lib();
  const result = lib.symbols.objc_msgSend(ptrIn(receiver), ptrIn(selector), arg);
  return bigIntOut(result);
};

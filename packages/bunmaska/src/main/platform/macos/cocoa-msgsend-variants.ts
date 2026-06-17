import { dlopen, FFIType } from 'bun:ffi';
import { cstr } from '../cstr';
import { type Handle, LIBOBJC_PATH, macOSLibraryAccessor } from './objc';

/**
 * Typed `objc_msgSend` variants for selectors whose signatures don't match
 * the zero-extra-arg form exposed on {@link CocoaRuntime}.
 *
 * Bun's FFI cannot declare two distinct signatures for the same symbol name
 * inside one `dlopen` call, so each variant `dlopen`s `libobjc.A.dylib` again
 * with a different signature. dyld dedupes the underlying image; the cost is
 * one extra `Library` wrapper object per variant.
 *
 * Every Objective-C object/selector slot is declared `u64` (not `pointer`) so
 * tagged-pointer objects survive the FFI boundary as full-precision bigints
 * (D029). Non-handle args keep their natural type (`f64`, `u8`, `i64`,
 * `cstring`).
 */

const INIT_WITH_CONTENT_RECT_VARIANT = {
  objc_msgSend: {
    args: [
      FFIType.u64,
      FFIType.u64,
      FFIType.f64,
      FFIType.f64,
      FFIType.f64,
      FFIType.f64,
      FFIType.u64,
      FFIType.u64,
      FFIType.u8,
    ],
    returns: FFIType.u64,
  },
} as const;

const PTR_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.u64],
    returns: FFIType.u64,
  },
} as const;

const U8_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.u8],
    returns: FFIType.u64,
  },
} as const;

const F64_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.f64],
    returns: FFIType.u64,
  },
} as const;

const I64_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.i64],
    returns: FFIType.u64,
  },
} as const;

const RETURNS_U8_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64],
    returns: FFIType.u8,
  },
} as const;

const CSTR_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.cstring],
    returns: FFIType.u64,
  },
} as const;

const PTR_PTR_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64],
    returns: FFIType.u64,
  },
} as const;

const PTR3_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64],
    returns: FFIType.u64,
  },
} as const;

const RETURNS_I64_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64],
    returns: FFIType.i64,
  },
} as const;

const PTR_RETURNS_U8_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.u64],
    returns: FFIType.u8,
  },
} as const;

const FRAME_CONFIG_VARIANT = {
  objc_msgSend: {
    args: [
      FFIType.u64,
      FFIType.u64,
      FFIType.f64,
      FFIType.f64,
      FFIType.f64,
      FFIType.f64,
      FFIType.u64,
    ],
    returns: FFIType.u64,
  },
} as const;

const SIZE_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.f64, FFIType.f64],
    returns: FFIType.u64,
  },
} as const;

// (receiver, selector, ptr, NSPoint{x,y} as two doubles (D018), ptr) -> BOOL.
// For -[NSMenu popUpMenuPositioningItem:atLocation:inView:].
const PTR_POINT_PTR_RETURNS_U8_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.u64, FFIType.f64, FFIType.f64, FFIType.u64],
    returns: FFIType.u8,
  },
} as const;

const getInitWithContentRectLib = macOSLibraryAccessor('msgSendInitWithContentRect', () =>
  dlopen(LIBOBJC_PATH, INIT_WITH_CONTENT_RECT_VARIANT),
);

const getPtrLib = macOSLibraryAccessor('msgSendPtr', () => dlopen(LIBOBJC_PATH, PTR_VARIANT));

const getU8Lib = macOSLibraryAccessor('msgSendU8', () => dlopen(LIBOBJC_PATH, U8_VARIANT));

const getF64Lib = macOSLibraryAccessor('msgSendF64', () => dlopen(LIBOBJC_PATH, F64_VARIANT));

const getI64Lib = macOSLibraryAccessor('msgSendI64', () => dlopen(LIBOBJC_PATH, I64_VARIANT));

const getReturnsU8Lib = macOSLibraryAccessor('msgSendReturnsU8', () =>
  dlopen(LIBOBJC_PATH, RETURNS_U8_VARIANT),
);

const getCStrLib = macOSLibraryAccessor('msgSendCStr', () => dlopen(LIBOBJC_PATH, CSTR_VARIANT));

const getPtrPtrLib = macOSLibraryAccessor('msgSendPtrPtr', () =>
  dlopen(LIBOBJC_PATH, PTR_PTR_VARIANT),
);

const getFrameConfigLib = macOSLibraryAccessor('msgSendInitWithFrameConfig', () =>
  dlopen(LIBOBJC_PATH, FRAME_CONFIG_VARIANT),
);

const getPtr3Lib = macOSLibraryAccessor('msgSendPtr3', () => dlopen(LIBOBJC_PATH, PTR3_VARIANT));

const getReturnsI64Lib = macOSLibraryAccessor('msgSendReturnsI64', () =>
  dlopen(LIBOBJC_PATH, RETURNS_I64_VARIANT),
);

const getPtrReturnsU8Lib = macOSLibraryAccessor('msgSendPtrReturnsU8', () =>
  dlopen(LIBOBJC_PATH, PTR_RETURNS_U8_VARIANT),
);

const getSizeLib = macOSLibraryAccessor('msgSendSize', () => dlopen(LIBOBJC_PATH, SIZE_VARIANT));

export type CGRectArgs = readonly [x: number, y: number, width: number, height: number];

/**
 * Send `initWithContentRect:styleMask:backing:defer:` to an NSWindow receiver.
 *
 * On both macOS ABIs (ARM64 and x86_64 SysV) a `CGRect` (struct of four
 * `double`s) is passed in exactly the same registers as four separate `double`
 * args, so this variant declares raw f64×4 in place of the CGRect struct — no
 * C shim required (D018).
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendInitWithContentRect = (
  receiver: Handle,
  selector: Handle,
  rect: CGRectArgs,
  styleMask: Handle,
  backing: Handle,
  defer: boolean,
): Handle =>
  getInitWithContentRectLib().symbols.objc_msgSend(
    receiver,
    selector,
    rect[0],
    rect[1],
    rect[2],
    rect[3],
    styleMask,
    backing,
    defer ? 1 : 0,
  );

/**
 * Send a message with one extra pointer-sized arg, e.g.
 * `[receiver setTitle:nsstring]`, `[receiver makeKeyAndOrderFront:nil]`,
 * `[receiver performSelector:sel]`.
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendPtr = (receiver: Handle, selector: Handle, arg: Handle): Handle =>
  getPtrLib().symbols.objc_msgSend(receiver, selector, arg);

/**
 * Send a message with one extra `u8` arg, e.g.
 * `[NSApp activateIgnoringOtherApps:YES]`, `[window setReleasedWhenClosed:NO]`,
 * `[NSNumber numberWithBool:YES]`. Pass `0` or `1` for the boolean.
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendU8 = (receiver: Handle, selector: Handle, arg: number): Handle =>
  getU8Lib().symbols.objc_msgSend(receiver, selector, arg);

/**
 * Send a message with one extra `double` arg, e.g.
 * `[NSDate dateWithTimeIntervalSinceNow:0.5]`.
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendF64 = (receiver: Handle, selector: Handle, arg: number): Handle =>
  getF64Lib().symbols.objc_msgSend(receiver, selector, arg);

/**
 * Send a message with one extra `int64_t` (signed) arg — used for `NSInteger`
 * params on 64-bit macOS, e.g. `[NSApp setActivationPolicy:0]`,
 * `[NSNumber numberWithInteger:n]`.
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendI64 = (receiver: Handle, selector: Handle, arg: bigint): Handle =>
  getI64Lib().symbols.objc_msgSend(receiver, selector, arg);

/**
 * Send a zero-extra-arg message that returns a `BOOL`, e.g. `[obj isProxy]`,
 * `[window isVisible]`, `[NSApp isActive]`. Returns 0 (NO) or 1 (YES).
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendReturnsU8 = (receiver: Handle, selector: Handle): number =>
  getReturnsU8Lib().symbols.objc_msgSend(receiver, selector);

/**
 * Send a message with one extra C-string arg, e.g.
 * `[NSString stringWithUTF8String:"..."]`. The text is encoded null-terminated.
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendCStr = (receiver: Handle, selector: Handle, text: string): Handle =>
  getCStrLib().symbols.objc_msgSend(receiver, selector, cstr(text));

/**
 * Send a message with two extra pointer-sized args, e.g.
 * `[webView loadHTMLString:html baseURL:url]`,
 * `[userContentController addScriptMessageHandler:handler name:nsstring]`.
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendPtrPtr = (
  receiver: Handle,
  selector: Handle,
  arg0: Handle,
  arg1: Handle,
): Handle => getPtrPtrLib().symbols.objc_msgSend(receiver, selector, arg0, arg1);

/**
 * Send `initWithFrame:configuration:` to a WKWebView receiver: a `CGRect`
 * (four `double`s via the struct-as-doubles trick, D018) plus a trailing
 * configuration pointer.
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendInitWithFrameConfig = (
  receiver: Handle,
  selector: Handle,
  frame: CGRectArgs,
  configuration: Handle,
): Handle =>
  getFrameConfigLib().symbols.objc_msgSend(
    receiver,
    selector,
    frame[0],
    frame[1],
    frame[2],
    frame[3],
    configuration,
  );

/**
 * Send a message with three extra pointer-sized args, e.g.
 * `[NSMenuItem initWithTitle:action:keyEquivalent:]`.
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendPtr3 = (
  receiver: Handle,
  selector: Handle,
  arg0: Handle,
  arg1: Handle,
  arg2: Handle,
): Handle => getPtr3Lib().symbols.objc_msgSend(receiver, selector, arg0, arg1, arg2);

/**
 * Send a zero-extra-arg message that returns an `NSInteger`, e.g.
 * `[menu numberOfItems]`, `[alert runModal]`.
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendReturnsI64 = (receiver: Handle, selector: Handle): bigint =>
  getReturnsI64Lib().symbols.objc_msgSend(receiver, selector);

/**
 * Send a message with one extra pointer-sized arg that returns a `BOOL`, e.g.
 * `[[NSWorkspace sharedWorkspace] openURL:nsurl]`. Returns 0 (NO) or 1 (YES).
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendPtrReturnsU8 = (receiver: Handle, selector: Handle, arg: Handle): number =>
  getPtrReturnsU8Lib().symbols.objc_msgSend(receiver, selector, arg);

/**
 * Send a message with an `NSSize`/`CGSize` arg (two `double`s by value), e.g.
 * `[window setContentSize:(NSSize){w, h}]`.
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendSize = (
  receiver: Handle,
  selector: Handle,
  width: number,
  height: number,
): Handle => getSizeLib().symbols.objc_msgSend(receiver, selector, width, height);

const getPtrPointPtrReturnsU8Lib = macOSLibraryAccessor('msgSendPtrPointPtrReturnsU8', () =>
  dlopen(LIBOBJC_PATH, PTR_POINT_PTR_RETURNS_U8_VARIANT),
);

/**
 * Send a message taking a pointer, an `NSPoint` (two `double`s BY VALUE — the
 * struct-as-doubles trick, D018), then a pointer, returning a `BOOL` — specifically
 * `-[NSMenu popUpMenuPositioningItem:atLocation:inView:]`. A 2-double homogeneous-FP struct
 * arg occupies the same registers as two separate doubles (proven by {@link msgSendSize}).
 */
export const msgSendPtrPointPtrReturnsU8 = (
  receiver: Handle,
  selector: Handle,
  item: Handle,
  x: number,
  y: number,
  view: Handle,
): number =>
  getPtrPointPtrReturnsU8Lib().symbols.objc_msgSend(receiver, selector, item, x, y, view);

const PTR_I64_U8_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.u64, FFIType.i64, FFIType.u8],
    returns: FFIType.u64,
  },
} as const;

const getPtrI64U8Lib = macOSLibraryAccessor('msgSendPtrI64U8', () =>
  dlopen(LIBOBJC_PATH, PTR_I64_U8_VARIANT),
);

/**
 * Send a message with a pointer arg, an `NSInteger` arg, and a `BOOL` arg —
 * specifically `[WKUserScript initWithSource:injectionTime:forMainFrameOnly:]`.
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendPtrI64U8 = (
  receiver: Handle,
  selector: Handle,
  arg0: Handle,
  arg1: bigint,
  arg2: number,
): Handle => getPtrI64U8Lib().symbols.objc_msgSend(receiver, selector, arg0, arg1, arg2);

const PTR4_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64],
    returns: FFIType.u64,
  },
} as const;

const getPtr4Lib = macOSLibraryAccessor('msgSendPtr4', () => dlopen(LIBOBJC_PATH, PTR4_VARIANT));

/**
 * Send a message with four extra pointer-sized args — specifically
 * `[WKWebView evaluateJavaScript:inFrame:inContentWorld:completionHandler:]`
 * (macOS 11+). Pass `frame = 0n` (main frame) and `completionHandler = 0n`
 * (`_Nullable`, fire-and-forget — no block thunk, no D022 hazard).
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendPtr4 = (
  receiver: Handle,
  selector: Handle,
  arg0: Handle,
  arg1: Handle,
  arg2: Handle,
  arg3: Handle,
): Handle => getPtr4Lib().symbols.objc_msgSend(receiver, selector, arg0, arg1, arg2, arg3);

const PTR_I64_U8_PTR_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.u64, FFIType.i64, FFIType.u8, FFIType.u64],
    returns: FFIType.u64,
  },
} as const;

const getPtrI64U8PtrLib = macOSLibraryAccessor('msgSendPtrI64U8Ptr', () =>
  dlopen(LIBOBJC_PATH, PTR_I64_U8_PTR_VARIANT),
);

/**
 * Send a message with a pointer arg, an `NSInteger` arg, a `BOOL` arg, and a
 * trailing pointer arg — specifically
 * `[WKUserScript initWithSource:injectionTime:forMainFrameOnly:inContentWorld:]`
 * (macOS 11+). The world handle is carried by the script object; `addUserScript:`
 * is unchanged.
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendPtrI64U8Ptr = (
  receiver: Handle,
  selector: Handle,
  arg0: Handle,
  arg1: bigint,
  arg2: number,
  arg3: Handle,
): Handle => getPtrI64U8PtrLib().symbols.objc_msgSend(receiver, selector, arg0, arg1, arg2, arg3);

const PTR_I64_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.u64, FFIType.i64],
    returns: FFIType.u64,
  },
} as const;

const getPtrI64Lib = macOSLibraryAccessor('msgSendPtrI64', () =>
  dlopen(LIBOBJC_PATH, PTR_I64_VARIANT),
);

/**
 * Send a message with a pointer arg and an `NSInteger`/`NSUInteger` arg —
 * specifically `[NSData dataWithBytes:(const void*)ptr length:(NSUInteger)len]`,
 * where the byte pointer is a pinned buffer and the length is its size.
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendPtrI64 = (
  receiver: Handle,
  selector: Handle,
  arg0: Handle,
  arg1: bigint,
): Handle => getPtrI64Lib().symbols.objc_msgSend(receiver, selector, arg0, arg1);

const I64_PTR_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.i64, FFIType.u64],
    returns: FFIType.u64,
  },
} as const;

const getI64PtrLib = macOSLibraryAccessor('msgSendI64Ptr', () =>
  dlopen(LIBOBJC_PATH, I64_PTR_VARIANT),
);

/**
 * Send a message with an `NSInteger` arg followed by a trailing pointer arg —
 * specifically `[NSBitmapImageRep representationUsingType:(NSBitmapImageFileType)
 * properties:(NSDictionary*)]` (the file-type enum then a nullable properties
 * dictionary).
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendI64Ptr = (
  receiver: Handle,
  selector: Handle,
  arg0: bigint,
  arg1: Handle,
): Handle => getI64PtrLib().symbols.objc_msgSend(receiver, selector, arg0, arg1);

const PTR_I64_PTR_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.u64, FFIType.i64, FFIType.u64],
    returns: FFIType.u64,
  },
} as const;

const getPtrI64PtrLib = macOSLibraryAccessor('msgSendPtrI64Ptr', () =>
  dlopen(LIBOBJC_PATH, PTR_I64_PTR_VARIANT),
);

/**
 * Send a message with a pointer arg, an `NSInteger` arg, and a trailing pointer
 * arg — specifically `[NSError errorWithDomain:code:userInfo:]` (domain string,
 * integer code, nullable userInfo dictionary).
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendPtrI64Ptr = (
  receiver: Handle,
  selector: Handle,
  arg0: Handle,
  arg1: bigint,
  arg2: Handle,
): Handle => getPtrI64PtrLib().symbols.objc_msgSend(receiver, selector, arg0, arg1, arg2);

const PTR_PTR_I64_PTR_VARIANT = {
  objc_msgSend: {
    args: [FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.i64, FFIType.u64],
    returns: FFIType.u64,
  },
} as const;

const getPtrPtrI64PtrLib = macOSLibraryAccessor('msgSendPtrPtrI64Ptr', () =>
  dlopen(LIBOBJC_PATH, PTR_PTR_I64_PTR_VARIANT),
);

/**
 * Send a message with two pointer args, an `NSInteger` arg, and a trailing
 * pointer arg — specifically `[[NSURLResponse alloc]
 * initWithURL:MIMEType:expectedContentLength:textEncodingName:]` (URL pointer,
 * MIME-type NSString pointer, content length, text-encoding NSString or 0).
 *
 * Only callable on macOS — throws {@link UnsupportedPlatformError} otherwise.
 */
export const msgSendPtrPtrI64Ptr = (
  receiver: Handle,
  selector: Handle,
  arg0: Handle,
  arg1: Handle,
  arg2: bigint,
  arg3: Handle,
): Handle => getPtrPtrI64PtrLib().symbols.objc_msgSend(receiver, selector, arg0, arg1, arg2, arg3);

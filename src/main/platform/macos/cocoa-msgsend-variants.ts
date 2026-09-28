import { FFIType } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { cstr } from '../cstr';
import { type Handle, LIBOBJC_PATH, macOSLibraryAccessor } from './objc';

const { u64, u8, i64, f64, cstring } = FFIType;

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
 *
 * Every export here is macOS-only: each throws {@link UnsupportedPlatformError}
 * on other platforms.
 */

export type CGRectArgs = readonly [x: number, y: number, width: number, height: number];

// D018: arm64 passes a 4-double CGRect (an HFA) in d0-d3, exactly like four doubles.
// x86_64 SysV classes a 32-byte struct MEMORY and copies it to the stack, so eight
// dummy doubles fill xmm0-7 first and the real four spill to the stack in field order.
const rectPadding = (arch: string): number => (arch === 'x64' ? 8 : 0);

/** The f64 values that pass `rect` by value on `arch` (D018). */
export const cgRectArgs = (rect: CGRectArgs, arch: string = process.arch): number[] => [
  ...new Array<number>(rectPadding(arch)).fill(0),
  ...rect,
];

/** The FFI slots matching {@link cgRectArgs} on this host. */
export const RECT_F64: readonly FFIType.f64[] = new Array<FFIType.f64>(
  rectPadding(process.arch) + 4,
).fill(FFIType.f64);

/** One lazily opened `objc_msgSend` binding with its own signature. */
const variant = <const Args extends readonly FFIType[], const Returns extends FFIType>(
  name: string,
  args: Args,
  returns: Returns,
) => {
  const library = macOSLibraryAccessor(name, () =>
    dlopen(LIBOBJC_PATH, { objc_msgSend: { args, returns } }),
  );
  return () => library().symbols.objc_msgSend;
};

const initWithContentRect = variant(
  'msgSendInitWithContentRect',
  [u64, u64, ...RECT_F64, u64, u64, u8],
  u64,
);
const rectU8 = variant('msgSendRectU8', [u64, u64, ...RECT_F64, u8], FFIType.void);
const ptr1 = variant('msgSendPtr', [u64, u64, u64], u64);
const u8Arg = variant('msgSendU8', [u64, u64, u8], u64);
const f64Arg = variant('msgSendF64', [u64, u64, f64], u64);
const i64Arg = variant('msgSendI64', [u64, u64, i64], u64);
const returnsU8 = variant('msgSendReturnsU8', [u64, u64], u8);
const cstrArg = variant('msgSendCStr', [u64, u64, cstring], u64);
const ptr2 = variant('msgSendPtrPtr', [u64, u64, u64, u64], u64);
const frameConfig = variant('msgSendInitWithFrameConfig', [u64, u64, ...RECT_F64, u64], u64);
const ptr3 = variant('msgSendPtr3', [u64, u64, u64, u64, u64], u64);
const returnsI64 = variant('msgSendReturnsI64', [u64, u64], i64);
const ptrReturnsU8 = variant('msgSendPtrReturnsU8', [u64, u64, u64], u8);
const size = variant('msgSendSize', [u64, u64, f64, f64], u64);
const ptrPointPtrReturnsU8 = variant(
  'msgSendPtrPointPtrReturnsU8',
  [u64, u64, u64, f64, f64, u64],
  u8,
);
const ptr4 = variant('msgSendPtr4', [u64, u64, u64, u64, u64, u64], u64);
const ptrI64U8Ptr = variant('msgSendPtrI64U8Ptr', [u64, u64, u64, i64, u8, u64], u64);
const ptrI64 = variant('msgSendPtrI64', [u64, u64, u64, i64], u64);
const i64Ptr = variant('msgSendI64Ptr', [u64, u64, i64, u64], u64);
const returnsF64 = variant('msgSendReturnsF64', [u64, u64], f64);
const ptrI64Ptr = variant('msgSendPtrI64Ptr', [u64, u64, u64, i64, u64], u64);
const ptrPtrI64Ptr = variant('msgSendPtrPtrI64Ptr', [u64, u64, u64, u64, i64, u64], u64);

/** Send `initWithContentRect:styleMask:backing:defer:`; the rect goes by value (D018). */
export const msgSendInitWithContentRect = (
  receiver: Handle,
  selector: Handle,
  rect: CGRectArgs,
  styleMask: Handle,
  backing: Handle,
  defer: boolean,
): Handle =>
  initWithContentRect()(receiver, selector, ...cgRectArgs(rect), styleMask, backing, defer ? 1 : 0);

/** Send a message with an NSRect by value (D018) plus a trailing BOOL. */
export const msgSendRectU8 = (
  receiver: Handle,
  selector: Handle,
  rect: CGRectArgs,
  flag: boolean,
): void => {
  rectU8()(receiver, selector, ...cgRectArgs(rect), flag ? 1 : 0);
};

export const msgSendPtr = (receiver: Handle, selector: Handle, arg: Handle): Handle =>
  ptr1()(receiver, selector, arg);

/** Send a message with one extra `BOOL` arg: pass `0` (NO) or `1` (YES). */
export const msgSendU8 = (receiver: Handle, selector: Handle, arg: number): Handle =>
  u8Arg()(receiver, selector, arg);

export const msgSendF64 = (receiver: Handle, selector: Handle, arg: number): Handle =>
  f64Arg()(receiver, selector, arg);

export const msgSendI64 = (receiver: Handle, selector: Handle, arg: bigint): Handle =>
  i64Arg()(receiver, selector, arg);

/** Send a zero-extra-arg message returning `BOOL`: 0 (NO) or 1 (YES). */
export const msgSendReturnsU8 = (receiver: Handle, selector: Handle): number =>
  returnsU8()(receiver, selector);

/** Send a message with one extra C-string arg; the text is encoded null-terminated. */
export const msgSendCStr = (receiver: Handle, selector: Handle, text: string): Handle =>
  cstrArg()(receiver, selector, cstr(text));

export const msgSendPtrPtr = (
  receiver: Handle,
  selector: Handle,
  arg0: Handle,
  arg1: Handle,
): Handle => ptr2()(receiver, selector, arg0, arg1);

/** Send `initWithFrame:configuration:`; the rect goes by value (D018). */
export const msgSendInitWithFrameConfig = (
  receiver: Handle,
  selector: Handle,
  frame: CGRectArgs,
  configuration: Handle,
): Handle => frameConfig()(receiver, selector, ...cgRectArgs(frame), configuration);

export const msgSendPtr3 = (
  receiver: Handle,
  selector: Handle,
  arg0: Handle,
  arg1: Handle,
  arg2: Handle,
): Handle => ptr3()(receiver, selector, arg0, arg1, arg2);

export const msgSendReturnsI64 = (receiver: Handle, selector: Handle): bigint =>
  returnsI64()(receiver, selector);

/** Send a message with one extra pointer arg, returning `BOOL`: 0 (NO) or 1 (YES). */
export const msgSendPtrReturnsU8 = (receiver: Handle, selector: Handle, arg: Handle): number =>
  ptrReturnsU8()(receiver, selector, arg);

/**
 * Send a message with an `NSSize`/`CGSize` arg (two `double`s by value), e.g.
 * `[window setContentSize:(NSSize){w, h}]`.
 */
export const msgSendSize = (
  receiver: Handle,
  selector: Handle,
  width: number,
  height: number,
): Handle => size()(receiver, selector, width, height);

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
): number => ptrPointPtrReturnsU8()(receiver, selector, item, x, y, view);

/**
 * Send a message with four extra pointer-sized args — specifically
 * `[WKWebView evaluateJavaScript:inFrame:inContentWorld:completionHandler:]`
 * (macOS 11+). Pass `frame = 0n` (main frame) and `completionHandler = 0n`
 * (`_Nullable`, fire-and-forget — no block thunk, no D022 hazard).
 */
export const msgSendPtr4 = (
  receiver: Handle,
  selector: Handle,
  arg0: Handle,
  arg1: Handle,
  arg2: Handle,
  arg3: Handle,
): Handle => ptr4()(receiver, selector, arg0, arg1, arg2, arg3);

/**
 * Send a message with a pointer arg, an `NSInteger` arg, a `BOOL` arg, and a
 * trailing pointer arg — specifically
 * `[WKUserScript initWithSource:injectionTime:forMainFrameOnly:inContentWorld:]`
 * (macOS 11+).
 */
export const msgSendPtrI64U8Ptr = (
  receiver: Handle,
  selector: Handle,
  arg0: Handle,
  arg1: bigint,
  arg2: number,
  arg3: Handle,
): Handle => ptrI64U8Ptr()(receiver, selector, arg0, arg1, arg2, arg3);

/**
 * Send a message with a pointer arg and an `NSInteger`/`NSUInteger` arg —
 * specifically `[NSData dataWithBytes:(const void*)ptr length:(NSUInteger)len]`,
 * where the byte pointer is a pinned buffer and the length is its size.
 */
export const msgSendPtrI64 = (
  receiver: Handle,
  selector: Handle,
  arg0: Handle,
  arg1: bigint,
): Handle => ptrI64()(receiver, selector, arg0, arg1);

/**
 * Send a message with an `NSInteger` arg followed by a trailing pointer arg —
 * specifically `[NSBitmapImageRep representationUsingType:(NSBitmapImageFileType)
 * properties:(NSDictionary*)]` (the file-type enum then a nullable properties
 * dictionary).
 */
export const msgSendI64Ptr = (
  receiver: Handle,
  selector: Handle,
  arg0: bigint,
  arg1: Handle,
): Handle => i64Ptr()(receiver, selector, arg0, arg1);

/**
 * Send a zero-extra-arg message returning a C `double` — e.g. `-[NSDate
 * timeIntervalSince1970]`. Plain `objc_msgSend` is correct on BOTH ABIs: ARM64
 * returns doubles in d0, and x86_64 in xmm0 (`objc_msgSend_fpret` exists only
 * for `long double` there) - no fpret variant needed.
 */
export const msgSendReturnsF64 = (receiver: Handle, selector: Handle): number =>
  returnsF64()(receiver, selector);

/**
 * Send a message with a pointer arg, an `NSInteger` arg, and a trailing pointer
 * arg — specifically `[NSError errorWithDomain:code:userInfo:]` (domain string,
 * integer code, nullable userInfo dictionary).
 */
export const msgSendPtrI64Ptr = (
  receiver: Handle,
  selector: Handle,
  arg0: Handle,
  arg1: bigint,
  arg2: Handle,
): Handle => ptrI64Ptr()(receiver, selector, arg0, arg1, arg2);

/**
 * Send a message with two pointer args, an `NSInteger` arg, and a trailing
 * pointer arg — specifically `[[NSURLResponse alloc]
 * initWithURL:MIMEType:expectedContentLength:textEncodingName:]` (URL pointer,
 * MIME-type NSString pointer, content length, text-encoding NSString or 0).
 */
export const msgSendPtrPtrI64Ptr = (
  receiver: Handle,
  selector: Handle,
  arg0: Handle,
  arg1: Handle,
  arg2: bigint,
  arg3: Handle,
): Handle => ptrPtrI64Ptr()(receiver, selector, arg0, arg1, arg2, arg3);

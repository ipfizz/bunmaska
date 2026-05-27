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

const openInitWithContentRect = () => dlopen(LIBOBJC_PATH, INIT_WITH_CONTENT_RECT_VARIANT);
let initWithContentRectLib: ReturnType<typeof openInitWithContentRect> | undefined;

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
  if (currentPlatform() !== 'macos') {
    throw new SambarError('msgSendInitWithContentRect is only supported on macOS');
  }
  if (initWithContentRectLib === undefined) {
    initWithContentRectLib = openInitWithContentRect();
  }
  const result = initWithContentRectLib.symbols.objc_msgSend(
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

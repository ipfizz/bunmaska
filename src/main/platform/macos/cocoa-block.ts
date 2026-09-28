import { FFIType, JSCallback, type Pointer, ptr } from 'bun:ffi';
import { callFromNative, dataSymbolAddress, type Handle } from './objc';

/**
 * Hand-built ObjC Blocks for completion-handler APIs (D022b). The runtime calls a
 * block as `invoke(block, ...args)`, reading `invoke` at offset 16:
 *
 * ```
 * struct Block_literal { void *isa; int flags; int reserved; void *invoke; void *descriptor; }
 * struct Block_descriptor { unsigned long reserved; unsigned long size; }
 * ```
 *
 * - `isa` = `&_NSConcreteGlobalBlock`: a GLOBAL block captures nothing, so the
 *   runtime never copies or frees it.
 * - `flags` = `BLOCK_IS_GLOBAL` (1 << 28). No copy/dispose helpers and no signature:
 *   direct invocation needs neither (verified with `dispatch_async` + the run loop).
 * - `invoke` = a JSCallback whose first parameter is the block itself.
 *
 * The literal and JSCallback stay in {@link retained} until the block fires, then
 * close on a deferred tick, never inside their own invocation (D022b).
 */

const BLOCK_IS_GLOBAL = 1 << 28;
const BLOCK_LITERAL_SIZE = 32;

let cachedIsa: Pointer | undefined;
/** `&_NSConcreteGlobalBlock`, the isa every global block points at. */
const globalBlockIsa = (): Pointer => {
  cachedIsa ??= dataSymbolAddress('/usr/lib/libSystem.B.dylib', '_NSConcreteGlobalBlock');
  return cachedIsa;
};

let sharedDescriptor: BigUint64Array | undefined;
/** A single `{ reserved: 0, size: 32 }` descriptor shared by all helper-less blocks. */
const descriptorPtr = (): Pointer => {
  sharedDescriptor ??= new BigUint64Array([0n, BigInt(BLOCK_LITERAL_SIZE)]);
  return ptr(sharedDescriptor);
};

type RetainedBlock = { readonly literal: Uint8Array; readonly cb: JSCallback; cancelled: boolean };
const retained = new Map<Handle, RetainedBlock>();

/** Number of blocks still awaiting their callback. Test-only. */
export const retainedBlockCount = (): number => retained.size;

/** A value the runtime can pass to a block parameter (an id/pointer or integer). */
export type BlockArg = number | bigint | null;

/**
 * Build a block for a completion handler called exactly once; it frees itself after
 * firing. `argTypes` follow the implicit block pointer, which `handler` never sees.
 * Declare ObjC object params as `FFIType.u64`: `ptr` loses tagged-pointer bits (D029).
 */
export const makeOneShotBlock = (
  handler: (...args: BlockArg[]) => void,
  argTypes: readonly FFIType[] = [],
): Handle => {
  let blockPtr = 0n;
  const cb = new JSCallback(
    (...all: BlockArg[]) => {
      if (retained.get(blockPtr)?.cancelled === false) {
        callFromNative(undefined, () => handler(...all.slice(1)));
      }
      setTimeout(() => {
        retained.delete(blockPtr);
        cb.close();
      }, 0).unref();
    },
    { args: [FFIType.ptr, ...argTypes], returns: FFIType.void },
  );
  const invokePtr = cb.ptr;
  if (invokePtr === null) {
    cb.close();
    throw new Error('cocoa-block: failed to allocate the block JSCallback');
  }

  const literal = new Uint8Array(BLOCK_LITERAL_SIZE);
  const view = new DataView(literal.buffer);
  view.setBigUint64(0, BigInt(globalBlockIsa()), true); // isa
  view.setInt32(8, BLOCK_IS_GLOBAL, true); // flags
  view.setInt32(12, 0, true); // reserved
  view.setBigUint64(16, BigInt(invokePtr), true); // invoke
  view.setBigUint64(24, BigInt(descriptorPtr()), true); // descriptor

  blockPtr = BigInt(ptr(literal));
  retained.set(blockPtr, { literal, cb, cancelled: false });
  return blockPtr;
};

/**
 * Silence a block whose caller gave up on it (a timed-out completion). The callee
 * still holds the pointer and may invoke it later, so it stays retained until it
 * fires and is then freed as usual; freeing it now would be a use-after-free.
 */
export const cancelOneShotBlock = (blockPtr: Handle): void => {
  const entry = retained.get(blockPtr);
  if (entry !== undefined) {
    entry.cancelled = true;
  }
};

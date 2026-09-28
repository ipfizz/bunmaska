import { FFIType, JSCallback, type Pointer, ptr } from 'bun:ffi';
import { callFromNative, dataSymbolAddress, type Handle } from './objc';

/**
 * Hand-built ObjC **Blocks** for bun:ffi — the primitive that unblocks every
 * completion-handler-based AppKit/WebKit API (D022, now SOLVED).
 *
 * A Block is a C struct whose 5th field (`invoke`, at offset 0x10) is a function
 * pointer the ObjC runtime calls as `invoke(block, ...args)`. We build a GLOBAL
 * block (no captured variables, so the runtime never copies/frees it) whose
 * `invoke` is a {@link JSCallback}:
 *
 * ```
 * struct Block_literal { void *isa; int flags; int reserved; void *invoke; void *descriptor; }
 * struct Block_descriptor { unsigned long reserved; unsigned long size; }
 * ```
 *
 * - `isa` = `&_NSConcreteGlobalBlock` (resolved once via `dlsym`).
 * - `flags` = `BLOCK_IS_GLOBAL` (1 << 28). No copy/dispose helpers, no signature
 *   (direct invocation does not need one — verified against `dispatch_async` +
 *   the run loop).
 * - `invoke` = the JSCallback pointer; its first parameter is the block itself.
 *
 * LIFETIME: a completion handler fires LATER, on the pumped run loop, so the
 * literal + descriptor + JSCallback must stay reachable until then — they are
 * held in {@link retained}. After the handler runs we close the JSCallback on a
 * DEFERRED tick (never synchronously inside its own invocation, which would free
 * the native trampoline mid-call and segfault — the same crash class as the GTK
 * `runAsyncDialog` callbacks).
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
 * Build a one-shot global Block whose handler runs when the runtime invokes it.
 * `argTypes` are the block's parameter FFI types AFTER the implicit leading block
 * pointer (which is dropped before `handler` is called). The handler receives the
 * real arguments in order. The block frees itself (deferred) after it fires, so
 * this is for completion handlers that are called exactly once.
 *
 * Returns the block pointer as a {@link Handle} to pass to an `objc_msgSend`
 * argument slot.
 */
export const makeOneShotBlock = (
  handler: (...args: BlockArg[]) => void,
  argTypes: readonly FFIType[] = [],
): Handle => {
  let blockPtr = 0n;
  const cb = new JSCallback(
    (...all: BlockArg[]) => {
      if (retained.get(blockPtr)?.cancelled === false) {
        // Drop the leading block pointer; hand the real args to the caller.
        callFromNative(undefined, () => handler(...all.slice(1)));
      }
      // Deferred close: never free the trampoline inside its own invocation.
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

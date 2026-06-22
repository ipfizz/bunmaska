import { dlopen, FFIType, JSCallback, type Pointer, ptr } from 'bun:ffi';
import { cstr } from '../cstr';
import type { Handle } from './objc';

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
/** Resolve `&_NSConcreteGlobalBlock` (the isa every global block points at), once. */
const globalBlockIsa = (): Pointer => {
  if (cachedIsa !== undefined) {
    return cachedIsa;
  }
  const libc = dlopen('/usr/lib/libSystem.B.dylib', {
    dlopen: { args: [FFIType.cstring, FFIType.i32], returns: FFIType.ptr },
    dlsym: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.ptr },
  });
  const handle = libc.symbols.dlopen(cstr('/usr/lib/libSystem.B.dylib'), 2);
  const isa = libc.symbols.dlsym(handle, cstr('_NSConcreteGlobalBlock'));
  if (isa === null) {
    throw new Error('cocoa-block: could not resolve _NSConcreteGlobalBlock');
  }
  cachedIsa = isa;
  return isa;
};

let sharedDescriptor: BigUint64Array | undefined;
/** A single `{ reserved: 0, size: 32 }` descriptor shared by all helper-less blocks. */
const descriptorPtr = (): Pointer => {
  sharedDescriptor ??= new BigUint64Array([0n, BigInt(BLOCK_LITERAL_SIZE)]);
  return ptr(sharedDescriptor);
};

type RetainedBlock = { readonly literal: Uint8Array; readonly cb: JSCallback };
const retained = new Set<RetainedBlock>();

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
  let entry: RetainedBlock | undefined;
  const cb = new JSCallback(
    (...all: BlockArg[]) => {
      try {
        // Drop the leading block pointer; hand the real args to the caller.
        handler(...all.slice(1));
      } finally {
        // Deferred close: never free the trampoline inside its own invocation.
        const settle = setTimeout(() => {
          if (entry !== undefined) {
            retained.delete(entry);
          }
          cb.close();
        }, 0);
        // Don't let the cleanup timer keep the process alive on its own.
        if (typeof settle === 'object' && settle !== null && 'unref' in settle) {
          (settle as { unref: () => void }).unref();
        }
      }
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

  entry = { literal, cb };
  retained.add(entry);
  return BigInt(ptr(literal));
};

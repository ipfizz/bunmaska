import { JSCallback, type Pointer } from 'bun:ffi';

/** ABI shape for `GAsyncReadyCallback`: `(source, result, user_data) -> void`. */
export const GASYNC_READY_CB_DEF = { args: ['ptr', 'ptr', 'ptr'], returns: 'void' } as const;

/** Retained so Bun cannot GC a thunk GLib still holds. */
const inFlight = new Set<JSCallback>();

/**
 * Start one async GLib operation and settle a Promise from its `GAsyncReadyCallback`.
 * `settle` runs inside the callback (call the matching `*_finish` there); a throw
 * rejects. The thunk closes on a later tick, never inside its own invocation
 * (D022b); if the operation never completes it stays retained, because native
 * code may still invoke it.
 */
export const runAsyncReady = <T>(
  start: (callbackPtr: Pointer) => void,
  settle: (result: Pointer) => T,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const callback = new JSCallback((_source: Pointer, result: Pointer, _userData: Pointer) => {
      try {
        resolve(settle(result));
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
      setTimeout(() => {
        inFlight.delete(callback);
        callback.close();
      }, 0);
    }, GASYNC_READY_CB_DEF);
    inFlight.add(callback);
    const cbPtr = callback.ptr;
    if (cbPtr === null) {
      inFlight.delete(callback);
      throw new Error('Failed to allocate a GAsyncReadyCallback thunk');
    }
    start(cbPtr);
  });

/** Reject `promise` if it has not settled within `ms` (the async op itself keeps running). */
export const withDeadline = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

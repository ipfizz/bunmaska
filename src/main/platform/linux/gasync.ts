import { JSCallback, type Pointer } from 'bun:ffi';

/**
 * Shared one-shot `GAsyncReadyCallback` runner (dialogs, cookies, snapshots).
 *
 * JSCallback lifecycle safety (a past SIGSEGV regression): the thunk MUST stay
 * reachable until GLib fires it, and MUST NOT be `close()`d synchronously inside
 * its own invocation (that frees the native trampoline the caller is about to
 * return into). Each in-flight callback is retained in {@link inFlight} and its
 * `close()` is deferred to a later tick.
 */

/** ABI shape for `GAsyncReadyCallback`: `(source, result, user_data) -> void`. */
export const GASYNC_READY_CB_DEF = { args: ['ptr', 'ptr', 'ptr'], returns: 'void' } as const;

/** Every JSCallback awaiting a GLib async settle. Retained so Bun can't GC it. */
const inFlight = new Set<JSCallback>();

/**
 * Kick off one async GLib operation and settle a Promise from its
 * `GAsyncReadyCallback`. `settle` runs inside the callback (call the matching
 * `*_finish` there); a thrown `settle` rejects. The thunk is closed on a
 * deferred tick after it fires; if the operation never completes the thunk
 * stays retained (never close a callback native code may still invoke).
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

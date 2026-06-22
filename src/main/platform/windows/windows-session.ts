import { FFIType, JSCallback, type Pointer } from 'bun:ffi';
import type { SessionBackend } from '../../api/session';
import { loadWebKit2 } from './webkit2-ffi';

/**
 * Windows `session` backend, the WinCairo peer of the macOS `WKWebsiteDataStore`
 * backend. `clearStorageData` clears the process-wide default data store: all
 * cookies (`WKHTTPCookieStore`) and the fetch caches (`WKWebsiteDataStore`). Both
 * WebKit operations are asynchronous and signal completion via a callback, which
 * fires on the cooperative pump (the same JSCallback pattern as the navigation
 * client) — so the returned Promise settles once the engine reports done.
 *
 * v1 covers cookies + fetch caches (the raw WK2 C API on this build exposes no
 * general "remove all website data" entry point — only these typed removers);
 * local/IndexedDB storage clearing is a follow-up.
 */

/** Completion trampolines kept alive until they fire; closed after each clear. */
const liveCallbacks: JSCallback[] = [];

/**
 * Run one async `WKWebsiteDataStore`/`WKHTTPCookieStore` removal that signals via
 * a completion callback, resolving when it fires. The JSCallback is retained in
 * {@link liveCallbacks} so it is not GC'd before completion; the caller closes
 * them AFTER the Promise settles (never from inside the native callback).
 */
const runWithCompletion = (start: (callback: Pointer) => void): Promise<void> =>
  new Promise<void>((resolve) => {
    const callback = new JSCallback(
      () => {
        resolve();
      },
      { args: [FFIType.ptr], returns: FFIType.void },
    );
    const pointer = callback.ptr;
    if (pointer === null) {
      resolve(); // could not allocate the trampoline — treat as completed
      return;
    }
    liveCallbacks.push(callback);
    start(pointer);
  });

export const windowsSessionBackend: SessionBackend = {
  async clearStorageData(): Promise<void> {
    const wk = loadWebKit2().symbols;
    const store = wk.WKWebsiteDataStoreGetDefaultDataStore();
    const cookieStore = wk.WKWebsiteDataStoreGetHTTPCookieStore(store);
    await Promise.all([
      runWithCompletion((cb) => wk.WKHTTPCookieStoreDeleteAllCookies(cookieStore, null, cb)),
      runWithCompletion((cb) => wk.WKWebsiteDataStoreRemoveAllFetchCaches(store, null, cb)),
    ]);
    // Both completions fired — release their trampolines now (outside the callback).
    while (liveCallbacks.length > 0) {
      liveCallbacks.pop()?.close();
    }
  },
};

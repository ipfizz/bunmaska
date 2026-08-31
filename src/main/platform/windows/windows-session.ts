import { FFIType, JSCallback, type Pointer } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import type { SessionBackend } from '../../api/session';
import { loadWebKit2 } from './webkit2-ffi';

/**
 * `clearStorageData` clears the process-wide default data store: cookies and fetch caches.
 * The raw WK2 C API on this build exposes no general "remove all website data" entry
 * point - only these typed removers - so local/IndexedDB clearing is a follow-up.
 */

/**
 * Run one async `WKWebsiteDataStore`/`WKHTTPCookieStore` removal that signals via
 * a completion callback, resolving when it fires. The JSCallback is pushed into
 * the CALLER's `owned` array so it is not GC'd before completion; the caller
 * closes its own array AFTER all its Promises settle (never from inside the
 * native callback, and never anyone else's still-in-flight trampolines - a
 * module-global drain once closed a concurrent call's live callback).
 */
const runWithCompletion = (
  start: (callback: Pointer) => void,
  owned: JSCallback[],
): Promise<void> =>
  new Promise<void>((resolve) => {
    const callback = new JSCallback(
      () => {
        resolve();
      },
      { args: [FFIType.ptr], returns: FFIType.void },
    );
    const pointer = callback.ptr;
    if (pointer === null) {
      resolve(); // could not allocate the trampoline - treat as completed
      return;
    }
    owned.push(callback);
    start(pointer);
  });

/**
 * The WinCairo WebKit C API gap: `WKHTTPCookieStore` exposes delete-all but no
 * FFI-usable cookie read/write (getters/setters traffic in WK object graphs
 * with no stable C accessors), so the cookie surface is honestly unsupported.
 */
const cookiesUnsupported = (method: string): Promise<never> =>
  Promise.reject(
    new UnsupportedPlatformError(
      `session.cookies.${method} is not supported on Windows: the WinCairo WebKit C API exposes no cookie read/write entry points`,
    ),
  );

export const windowsSessionBackend: SessionBackend = {
  async clearStorageData(): Promise<void> {
    const wk = loadWebKit2().symbols;
    const store = wk.WKWebsiteDataStoreGetDefaultDataStore();
    const cookieStore = wk.WKWebsiteDataStoreGetHTTPCookieStore(store);
    // Scoped per call: a concurrent clearStorageData must not have its
    // still-pending trampolines closed by this call's drain.
    const owned: JSCallback[] = [];
    await Promise.all([
      runWithCompletion((cb) => wk.WKHTTPCookieStoreDeleteAllCookies(cookieStore, null, cb), owned),
      runWithCompletion((cb) => wk.WKWebsiteDataStoreRemoveAllFetchCaches(store, null, cb), owned),
    ]);
    // Both completions fired - release this call's trampolines (outside the callback).
    for (const callback of owned) {
      callback.close();
    }
  },
  getCookies: () => cookiesUnsupported('get'),
  setCookie: () => cookiesUnsupported('set'),
  removeCookie: () => cookiesUnsupported('remove'),
};

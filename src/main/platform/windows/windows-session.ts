import { FFIType, JSCallback, type Pointer } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import type { SessionBackend } from '../../api/session';
import { loadWebKit2 } from './webkit2-ffi';

/**
 * Resolve when one async WK removal fires its completion. The JSCallback goes into the
 * caller's `owned`, which the caller closes after ALL its promises settle: never inside the
 * callback (use-after-free), never another call's (a module-global drain once closed a
 * concurrent call's live trampoline).
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

const cookiesUnsupported = (method: string): Promise<never> =>
  Promise.reject(
    new UnsupportedPlatformError(
      `session.cookies.${method} is not supported on Windows: the WinCairo WebKit C API exposes no cookie read/write entry points`,
    ),
  );

export const windowsSessionBackend: SessionBackend = {
  // ponytail: cookies and fetch caches only; local storage and IndexedDB need WK removers
  // this WebKit2.dll may not export (check WKWebsiteDataStoreRemoveLocalStorage).
  async clearStorageData(): Promise<void> {
    const wk = loadWebKit2().symbols;
    const store = wk.WKWebsiteDataStoreGetDefaultDataStore();
    const cookieStore = wk.WKWebsiteDataStoreGetHTTPCookieStore(store);
    const owned: JSCallback[] = [];
    await Promise.all([
      runWithCompletion((cb) => wk.WKHTTPCookieStoreDeleteAllCookies(cookieStore, null, cb), owned),
      runWithCompletion((cb) => wk.WKWebsiteDataStoreRemoveAllFetchCaches(store, null, cb), owned),
    ]);
    for (const callback of owned) {
      callback.close();
    }
  },
  getCookies: () => cookiesUnsupported('get'),
  setCookie: () => cookiesUnsupported('set'),
  removeCookie: () => cookiesUnsupported('remove'),
};

import { runAsyncReady, withDeadline } from './gasync';
import { loadWebKitGtkFFI } from './webkitgtk-ffi';

const CLEAR_TIMEOUT_MS = 15_000;
/** `WEBKIT_WEBSITE_DATA_ALL` in WebKitGTK 6 (`(1 << 12) - 1`). */
export const WEBKIT_WEBSITE_DATA_ALL = (1 << 12) - 1;

/** Clears every website-data type the default network session holds. */
export const linuxClearStorageData = (): Promise<void> => {
  const wk = loadWebKitGtkFFI().symbols;
  const session = wk.webkit_network_session_get_default();
  if (session === null) {
    return Promise.reject(new Error('webkit_network_session_get_default returned null'));
  }
  const manager = wk.webkit_network_session_get_website_data_manager(session);
  if (manager === null) {
    return Promise.reject(new Error('webkit_network_session_get_website_data_manager returned null'));
  }
  return withDeadline(
    runAsyncReady(
      (cb) => wk.webkit_website_data_manager_clear(manager, WEBKIT_WEBSITE_DATA_ALL, 0n, null, cb, null),
      (result) => {
        if (wk.webkit_website_data_manager_clear_finish(manager, result, null) === 0) {
          throw new Error('webkit_website_data_manager_clear failed');
        }
      },
    ),
    CLEAR_TIMEOUT_MS,
    'session.clearStorageData',
  );
};

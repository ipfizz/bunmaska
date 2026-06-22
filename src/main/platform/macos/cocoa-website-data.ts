import { makeOneShotBlock } from './cocoa-block';
import { msgSendPtr3 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';

/**
 * macOS website-data management via `WKWebsiteDataStore`.
 *
 * `clearStorageData` removes every website data type (cache, cookies,
 * local/session storage, IndexedDB, …) from the default data store since the
 * distant past via `-[WKWebsiteDataStore removeDataOfTypes:modifiedSince:
 * completionHandler:]`. The completion handler is a hand-built ObjC Block
 * (D022b) that fires on the pumped run loop, so the returned Promise settles
 * when the removal finishes.
 */

const CLEAR_TIMEOUT_MS = 15000;

/** Remove all website data from the default store; resolves when it completes. */
export const clearStorageData = (): Promise<void> => {
  const rt = cocoa();
  const store = rt.msgSend(
    rt.classes.get('WKWebsiteDataStore'),
    rt.selectors.get('defaultDataStore'),
  );
  const types = rt.msgSend(
    rt.classes.get('WKWebsiteDataStore'),
    rt.selectors.get('allWebsiteDataTypes'),
  );
  const since = rt.msgSend(rt.classes.get('NSDate'), rt.selectors.get('distantPast'));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`clearStorageData timed out after ${CLEAR_TIMEOUT_MS}ms`));
    }, CLEAR_TIMEOUT_MS);
    // Completion handler is ^(void) — no arguments beyond the implicit block.
    const block = makeOneShotBlock(() => {
      clearTimeout(timer);
      resolve();
    }, []);
    msgSendPtr3(
      store,
      rt.selectors.get('removeDataOfTypes:modifiedSince:completionHandler:'),
      types,
      since,
      block,
    );
  });
};

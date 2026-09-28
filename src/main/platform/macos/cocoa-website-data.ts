import { makeOneShotBlock } from './cocoa-block';
import { bounded } from './cocoa-cookies';
import { nsString } from './cocoa-foundation';
import { msgSendPtr, msgSendPtr3 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { loadWebKit } from './cocoa-webkit';

/** Remove the default store's website data, bar the in-process memory cache; resolves when done (D022b). */
export const clearStorageData = (): Promise<void> =>
  bounded('clearStorageData', (resolve) => {
    loadWebKit();
    const rt = cocoa();
    const store = rt.classes.get('WKWebsiteDataStore');
    const types = msgSendPtr(
      rt.classes.get('NSMutableSet'),
      rt.selectors.get('setWithSet:'),
      rt.msgSend(store, rt.selectors.get('allWebsiteDataTypes')),
    );
    // Only the memory cache waits on every web process, and a hidden view's process
    // runs DarwinBG: on a saturated CPU it never replies, so the removal never completes.
    msgSendPtr(types, rt.selectors.get('removeObject:'), nsString('WKWebsiteDataTypeMemoryCache'));
    msgSendPtr3(
      rt.msgSend(store, rt.selectors.get('defaultDataStore')),
      rt.selectors.get('removeDataOfTypes:modifiedSince:completionHandler:'),
      types,
      rt.msgSend(rt.classes.get('NSDate'), rt.selectors.get('distantPast')),
      makeOneShotBlock(() => resolve(undefined), []),
    );
  });

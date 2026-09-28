import { makeOneShotBlock } from './cocoa-block';
import { bounded } from './cocoa-cookies';
import { msgSendPtr3 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { loadWebKit } from './cocoa-webkit';

/** Remove all website data from the default store; resolves when it completes (D022b). */
export const clearStorageData = (): Promise<void> =>
  bounded('clearStorageData', (resolve) => {
    loadWebKit();
    const rt = cocoa();
    const store = rt.classes.get('WKWebsiteDataStore');
    msgSendPtr3(
      rt.msgSend(store, rt.selectors.get('defaultDataStore')),
      rt.selectors.get('removeDataOfTypes:modifiedSince:completionHandler:'),
      rt.msgSend(store, rt.selectors.get('allWebsiteDataTypes')),
      rt.msgSend(rt.classes.get('NSDate'), rt.selectors.get('distantPast')),
      makeOneShotBlock(() => resolve(undefined), []),
    );
  });

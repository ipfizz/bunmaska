import { nsString } from './cocoa-foundation';
import { msgSendPtr } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';

/**
 * Loads `WebKit.framework` through `NSBundle` rather than `dlopen`: modern system
 * frameworks live in the dyld shared cache and expose few C symbols, but
 * `[bundle load]` reliably registers their Objective-C classes.
 */

let loaded = false;

export const loadWebKit = (): void => {
  if (loaded) {
    return;
  }
  const rt = cocoa();
  const path = nsString('/System/Library/Frameworks/WebKit.framework');
  const bundle = msgSendPtr(rt.classes.get('NSBundle'), rt.selectors.get('bundleWithPath:'), path);
  rt.msgSend(bundle, rt.selectors.get('load'));
  loaded = true;
};

import { nsString } from './cocoa-foundation';
import { msgSendPtr } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';

let loaded = false;

/**
 * Register WebKit's classes (`WKWebView` and friends); idempotent. Loaded via NSBundle
 * because Bun's dlopen needs a declared C symbol and WebKit's public API is ObjC only.
 */
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

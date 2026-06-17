import { nsStringToString } from './cocoa-foundation';
import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { Handle } from './objc';

/**
 * Bridges `WKUIDelegate` window-open requests to JS (D026).
 *
 * `webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:` is
 * WebKit's hook for `window.open` / `target=_blank`. We read the target URL from
 * the navigation action, hand it to the registered JS handler, and return nil —
 * i.e. no child web view is created (v1 supports the deny path; the app typically
 * opens the URL externally from its handler).
 */

const registry = new Map<Handle, (url: string) => void>();

let delegateClass: Handle | undefined;

const ensureDelegateClass = (): Handle => {
  if (delegateClass !== undefined) {
    return delegateClass;
  }
  delegateClass = defineObjcClass('BunmaskaUIDelegate', 'NSObject', [
    {
      selector: 'webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:',
      typeEncoding: '@@:@@@@',
      args: ['object', 'object', 'object', 'object'],
      returns: 'object',
      impl: (self, _cmd, _webView, _config, navigationAction) => {
        const handler = registry.get(self);
        if (handler !== undefined) {
          const rt = cocoa();
          const request = rt.msgSend(navigationAction, rt.selectors.get('request'));
          const url = request === 0n ? 0n : rt.msgSend(request, rt.selectors.get('URL'));
          handler(
            url === 0n ? '' : nsStringToString(rt.msgSend(url, rt.selectors.get('absoluteString'))),
          );
        }
        return 0n;
      },
    },
  ]);
  return delegateClass;
};

export type UIDelegate = {
  /** The Objective-C delegate instance to pass to `setUIDelegate:`. */
  readonly handle: Handle;
};

/** Create a `WKUIDelegate` whose window-open requests call `onWindowOpen(url)`. */
export const createUIDelegate = (onWindowOpen: (url: string) => void): UIDelegate => {
  const rt = cocoa();
  const cls = ensureDelegateClass();
  const handle = rt.msgSend(rt.msgSend(cls, rt.selectors.get('alloc')), rt.selectors.get('init'));
  registry.set(handle, onWindowOpen);
  return { handle };
};

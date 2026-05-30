import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { Handle } from './objc';

/**
 * Bridges `WKNavigationDelegate` callbacks to JS.
 *
 * WebKit reports navigation lifecycle (`webView:didFinishNavigation:`) to a
 * delegate object set on the web view via `setNavigationDelegate:`. We define
 * that class once at runtime (D026), allocate one instance per web view, and
 * route each instance's callback to its registered JS handler by keying on the
 * `self` handle delivered to the IMP — the same mechanism proven for the script
 * message handler.
 */

const registry = new Map<Handle, () => void>();

let delegateClass: Handle | undefined;

const ensureDelegateClass = (): Handle => {
  if (delegateClass !== undefined) {
    return delegateClass;
  }
  delegateClass = defineObjcClass('SambarNavigationDelegate', 'NSObject', [
    {
      selector: 'webView:didFinishNavigation:',
      typeEncoding: 'v@:@@',
      args: ['object', 'object'],
      impl: (self) => {
        registry.get(self)?.();
      },
    },
  ]);
  return delegateClass;
};

export type NavigationDelegate = {
  /** The Objective-C delegate instance to pass to `setNavigationDelegate:`. */
  readonly handle: Handle;
};

/** Create a `WKNavigationDelegate` whose `didFinish` callback runs `onDidFinish`. */
export const createNavigationDelegate = (onDidFinish: () => void): NavigationDelegate => {
  const rt = cocoa();
  const cls = ensureDelegateClass();
  const handle = rt.msgSend(rt.msgSend(cls, rt.selectors.get('alloc')), rt.selectors.get('init'));
  registry.set(handle, onDidFinish);
  return { handle };
};

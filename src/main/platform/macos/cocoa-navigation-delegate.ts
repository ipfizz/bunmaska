import type { NativeNavigationEvent } from '../native';
import { nsStringToString } from './cocoa-foundation';
import { msgSendReturnsI64 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { Handle } from './objc';

/**
 * Bridges `WKNavigationDelegate` callbacks to JS (D026), one instance per web
 * view, routed by the `self` handle delivered to the IMP.
 */

const registry = new Map<Handle, (event: NativeNavigationEvent) => void>();

let delegateClass: Handle | undefined;

const failEvent = (error: Handle): NativeNavigationEvent => {
  const rt = cocoa();
  return {
    type: 'did-fail-load',
    errorCode: Number(msgSendReturnsI64(error, rt.selectors.get('code'))),
    errorDescription: nsStringToString(rt.msgSend(error, rt.selectors.get('localizedDescription'))),
  };
};

const ensureDelegateClass = (): Handle => {
  if (delegateClass !== undefined) {
    return delegateClass;
  }
  delegateClass = defineObjcClass('BunmaskaNavigationDelegate', 'NSObject', [
    {
      selector: 'webView:didStartProvisionalNavigation:',
      typeEncoding: 'v@:@@',
      args: ['object', 'object'],
      impl: (self) => registry.get(self)?.({ type: 'did-start-loading' }),
    },
    {
      selector: 'webView:didCommitNavigation:',
      typeEncoding: 'v@:@@',
      args: ['object', 'object'],
      impl: (self) => registry.get(self)?.({ type: 'did-navigate' }),
    },
    {
      selector: 'webView:didFinishNavigation:',
      typeEncoding: 'v@:@@',
      args: ['object', 'object'],
      impl: (self) => {
        const handler = registry.get(self);
        handler?.({ type: 'did-finish-load' });
        handler?.({ type: 'did-stop-loading' });
      },
    },
    {
      selector: 'webView:didFailNavigation:withError:',
      typeEncoding: 'v@:@@@',
      args: ['object', 'object', 'object'],
      impl: (self, _cmd, _webView, _navigation, error) => {
        const handler = registry.get(self);
        handler?.(failEvent(error));
        handler?.({ type: 'did-stop-loading' });
      },
    },
    {
      selector: 'webView:didFailProvisionalNavigation:withError:',
      typeEncoding: 'v@:@@@',
      args: ['object', 'object', 'object'],
      impl: (self, _cmd, _webView, _navigation, error) => {
        const handler = registry.get(self);
        handler?.(failEvent(error));
        handler?.({ type: 'did-stop-loading' });
      },
    },
  ]);
  return delegateClass;
};

export type NavigationDelegate = {
  /** The Objective-C delegate instance to pass to `setNavigationDelegate:`. */
  readonly handle: Handle;
  /** Unregister and release the delegate instance (window teardown). */
  readonly destroy: () => void;
};

/** Create a `WKNavigationDelegate` routing its callbacks to `onNavigation`. */
export const createNavigationDelegate = (
  onNavigation: (event: NativeNavigationEvent) => void,
): NavigationDelegate => {
  const rt = cocoa();
  const cls = ensureDelegateClass();
  const handle = rt.msgSend(rt.msgSend(cls, rt.selectors.get('alloc')), rt.selectors.get('init'));
  registry.set(handle, onNavigation);
  return {
    handle,
    destroy: () => {
      registry.delete(handle);
      rt.msgSend(handle, rt.selectors.get('release'));
    },
  };
};

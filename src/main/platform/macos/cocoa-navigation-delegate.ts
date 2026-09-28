import type { NativeNavigationEvent } from '../native';
import { nsStringToString } from './cocoa-foundation';
import { msgSendReturnsI64 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { Handle } from './objc';

/** `WKNavigationDelegate` bridge (D026): one instance per web view, routed by the IMP's `self`. */

const registry = new Map<Handle, (event: NativeNavigationEvent) => void>();

let delegateClass: Handle | undefined;

/** NSURLErrorDomain codes Electron apps branch on, as the Chromium net errors Electron reports. */
const NET_ERROR_BY_NSURL_CODE: ReadonlyMap<number, number> = new Map([
  [-999, -3], // cancelled: ERR_ABORTED
  [-1001, -7], // timed out: ERR_TIMED_OUT
  [-1003, -105], // cannot find host: ERR_NAME_NOT_RESOLVED
  [-1009, -106], // not connected: ERR_INTERNET_DISCONNECTED
]);

const failEvent = (error: Handle): NativeNavigationEvent => {
  const rt = cocoa();
  const code = Number(msgSendReturnsI64(error, rt.selectors.get('code')));
  const domain = nsStringToString(rt.msgSend(error, rt.selectors.get('domain')));
  const netError = domain === 'NSURLErrorDomain' ? NET_ERROR_BY_NSURL_CODE.get(code) : undefined;
  return {
    type: 'did-fail-load',
    errorCode: netError ?? code,
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

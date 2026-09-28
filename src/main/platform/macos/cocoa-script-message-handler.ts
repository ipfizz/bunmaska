import { nsStringToString } from './cocoa-foundation';
import { msgSendPtrReturnsU8 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { Handle } from './objc';

/** `WKScriptMessageHandler` bridge (D021, D026): one instance per web view, routed by `self`. */

const registry = new Map<Handle, (envelopeJson: string) => void>();

let handlerClass: Handle | undefined;

const ensureHandlerClass = (): Handle => {
  if (handlerClass !== undefined) {
    return handlerClass;
  }
  const rt = cocoa();
  handlerClass = defineObjcClass('BunmaskaScriptMessageHandler', 'NSObject', [
    {
      selector: 'userContentController:didReceiveScriptMessage:',
      typeEncoding: 'v@:@@',
      args: ['object', 'object'],
      impl: (self, _cmd, _controller, message) => {
        const callback = registry.get(self);
        if (callback === undefined) {
          return;
        }
        const body = rt.msgSend(message, rt.selectors.get('body'));
        // Any page can post null/1/{}; UTF8String on a non-NSString is an uncatchable NSException.
        const isString = msgSendPtrReturnsU8(
          body,
          rt.selectors.get('isKindOfClass:'),
          rt.classes.get('NSString'),
        );
        if (isString === 1) {
          callback(nsStringToString(body));
        }
      },
    },
  ]);
  return handlerClass;
};

export type ScriptMessageHandler = {
  /** The Objective-C handler instance to pass to `addScriptMessageHandler:name:`. */
  readonly handle: Handle;
  /**
   * Unroute and release. Idempotent. Call only AFTER detaching from the
   * `userContentController`, or a late message reaches a freed instance.
   */
  dispose(): void;
};

/** Create a handler that passes each posted string body to `onEnvelope` as raw JSON. */
export const createScriptMessageHandler = (
  onEnvelope: (envelopeJson: string) => void,
): ScriptMessageHandler => {
  const rt = cocoa();
  const cls = ensureHandlerClass();
  const handle = rt.msgSend(rt.msgSend(cls, rt.selectors.get('alloc')), rt.selectors.get('init'));
  registry.set(handle, onEnvelope);
  let disposed = false;
  return {
    handle,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      registry.delete(handle);
      cocoa().msgSend(handle, cocoa().selectors.get('release'));
    },
  };
};

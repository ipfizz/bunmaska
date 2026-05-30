import { nsStringToString } from './cocoa-foundation';
import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { Handle } from './objc';

/**
 * Bridges `WKScriptMessageHandler` callbacks to JS.
 *
 * WebKit requires a real Objective-C object conforming to
 * `WKScriptMessageHandler` to receive
 * `window.webkit.messageHandlers.<name>.postMessage(...)`. We define that class
 * once at runtime (D026), allocate one instance per web view, and route each
 * instance's messages to its registered JS callback by keying on the `self`
 * handle delivered to the IMP.
 */

const registry = new Map<Handle, (envelopeJson: string) => void>();

let handlerClass: Handle | undefined;

const ensureHandlerClass = (): Handle => {
  if (handlerClass !== undefined) {
    return handlerClass;
  }
  const rt = cocoa();
  handlerClass = defineObjcClass('SambarScriptMessageHandler', 'NSObject', [
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
        callback(nsStringToString(body));
      },
    },
  ]);
  return handlerClass;
};

export type ScriptMessageHandler = {
  /** The Objective-C handler instance to pass to `addScriptMessageHandler:name:`. */
  readonly handle: Handle;
};

/**
 * Create a `WKScriptMessageHandler` instance whose messages are delivered to
 * `onEnvelope` as the raw JSON string the renderer posted.
 */
export const createScriptMessageHandler = (
  onEnvelope: (envelopeJson: string) => void,
): ScriptMessageHandler => {
  const rt = cocoa();
  const cls = ensureHandlerClass();
  const handle = rt.msgSend(rt.msgSend(cls, rt.selectors.get('alloc')), rt.selectors.get('init'));
  registry.set(handle, onEnvelope);
  return { handle };
};

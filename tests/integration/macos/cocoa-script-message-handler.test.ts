import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { nsString } from '../../../src/main/platform/macos/cocoa-foundation';
import { msgSendI64, msgSendPtrPtr } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import { defineObjcClass } from '../../../src/main/platform/macos/cocoa-runtime-class';
import { createScriptMessageHandler } from '../../../src/main/platform/macos/cocoa-script-message-handler';
import type { Handle } from '../../../src/main/platform/macos/objc';

let nextBody: Handle = 0n;
let fakeMessageClass: Handle | undefined;

/** A main-frame `WKScriptMessage` stand-in whose `-body` returns `body`; it is its own frameInfo. */
const fakeMessage = (body: Handle): Handle => {
  const rt = cocoa();
  fakeMessageClass ??= defineObjcClass('BunmaskaTestScriptMessage', 'NSObject', [
    { selector: 'body', typeEncoding: '@@:', args: [], returns: 'object', impl: () => nextBody },
    {
      selector: 'frameInfo',
      typeEncoding: '@@:',
      args: [],
      returns: 'object',
      impl: (self) => self,
    },
    { selector: 'isMainFrame', typeEncoding: 'c@:', args: [], returns: 'bool', impl: () => 1 },
  ]);
  nextBody = body;
  return rt.msgSend(
    rt.msgSend(fakeMessageClass, rt.selectors.get('alloc')),
    rt.selectors.get('init'),
  );
};

const post = (handler: Handle, body: Handle): void => {
  const sel = cocoa().selectors.get('userContentController:didReceiveScriptMessage:');
  msgSendPtrPtr(handler, sel, 0n, fakeMessage(body));
};

if (currentPlatform() === 'macos') {
  describe('BunmaskaScriptMessageHandler', () => {
    test('a string body reaches the callback', () => {
      const seen: string[] = [];
      const handler = createScriptMessageHandler((json) => seen.push(json));
      post(handler.handle, nsString('{"a":1}'));
      expect(seen).toEqual(['{"a":1}']);
      handler.dispose();
    });

    test('non-string bodies are dropped instead of aborting the process', () => {
      const rt = cocoa();
      const seen: string[] = [];
      const handler = createScriptMessageHandler((json) => seen.push(json));
      post(handler.handle, rt.msgSend(rt.classes.get('NSNull'), rt.selectors.get('null')));
      post(
        handler.handle,
        msgSendI64(rt.classes.get('NSNumber'), rt.selectors.get('numberWithLongLong:'), 1n),
      );
      post(handler.handle, 0n);
      expect(seen).toEqual([]);
      handler.dispose();
    });

    test('dispose stops routing messages to the callback', () => {
      const rt = cocoa();
      const seen: string[] = [];
      const handler = createScriptMessageHandler((json) => seen.push(json));
      rt.msgSend(handler.handle, rt.selectors.get('retain'));
      handler.dispose();
      post(handler.handle, nsString('late'));
      expect(seen).toEqual([]);
      rt.msgSend(handler.handle, rt.selectors.get('release'));
    });
  });
}

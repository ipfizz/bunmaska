import type { Pointer } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import { deliverScriptMessage } from '../../../../../src/main/platform/windows/windows-webkit-view';

type ScriptMessageApi = NonNullable<Parameters<typeof deliverScriptMessage>[3]>;

const MESSAGE = 0x10 as Pointer;
const BODY = 0x20 as Pointer;
const FRAME = 0x30 as Pointer;
const LISTENER = 0x40 as Pointer;
const STRING_TYPE = 7;
const DOUBLE_TYPE = 9;

const fakeWk = (bodyType: number, isMainFrame = true) => {
  const completed: unknown[] = [];
  const api: ScriptMessageApi = {
    WKScriptMessageGetBody: () => BODY,
    WKScriptMessageGetFrameInfo: () => FRAME,
    WKFrameInfoGetIsMainFrame: (frame) => frame === FRAME && isMainFrame,
    WKGetTypeID: () => bodyType,
    WKStringGetTypeID: () => STRING_TYPE,
    WKCompletionListenerComplete: (listener) => {
      completed.push(listener);
    },
  };
  return { api, completed };
};

const readBody = (ref: Pointer): string => (ref === BODY ? '{"ping":"pong"}' : 'wrong ref');

describe('deliverScriptMessage', () => {
  test('forwards a string body to the handler', () => {
    const received: string[] = [];
    const { api } = fakeWk(STRING_TYPE);
    deliverScriptMessage(MESSAGE, LISTENER, (body) => received.push(body), api, readBody);
    expect(received).toEqual(['{"ping":"pong"}']);
  });

  test('drops a non-string body without reading it as a WKString', () => {
    const received: string[] = [];
    const readAsString = (): string => {
      throw new Error('read a non-string body as a WKString');
    };
    const { api } = fakeWk(DOUBLE_TYPE);
    deliverScriptMessage(MESSAGE, LISTENER, (body) => received.push(body), api, readAsString);
    expect(received).toEqual([]);
  });

  test('drops a message posted from a subframe', () => {
    const received: string[] = [];
    const { api } = fakeWk(STRING_TYPE, false);
    deliverScriptMessage(MESSAGE, LISTENER, (body) => received.push(body), api, readBody);
    expect(received).toEqual([]);
  });

  test('completes the reply whether the message is delivered or dropped', () => {
    for (const { api, completed } of [
      fakeWk(STRING_TYPE),
      fakeWk(DOUBLE_TYPE),
      fakeWk(STRING_TYPE, false),
    ]) {
      deliverScriptMessage(MESSAGE, LISTENER, () => undefined, api, readBody);
      expect(completed).toEqual([LISTENER]);
    }
  });

  test('completes the reply when the handler throws', () => {
    const { api, completed } = fakeWk(STRING_TYPE);
    const throwing = (): void => {
      throw new Error('handler failed');
    };
    expect(() => deliverScriptMessage(MESSAGE, LISTENER, throwing, api, readBody)).toThrow(
      'handler failed',
    );
    expect(completed).toEqual([LISTENER]);
  });
});

import type { Pointer } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import { deliverScriptMessage } from '../../../../../src/main/platform/windows/windows-webkit-view';

type ScriptMessageApi = NonNullable<Parameters<typeof deliverScriptMessage>[2]>;

const MESSAGE = 0x10 as Pointer;
const BODY = 0x20 as Pointer;
const STRING_TYPE = 7;
const DOUBLE_TYPE = 9;

const fakeWk = (bodyType: number): ScriptMessageApi => ({
  WKScriptMessageGetBody: () => BODY,
  WKGetTypeID: () => bodyType,
  WKStringGetTypeID: () => STRING_TYPE,
});

const readBody = (ref: Pointer): string => (ref === BODY ? '{"ping":"pong"}' : 'wrong ref');

describe('deliverScriptMessage', () => {
  test('forwards a string body to the handler', () => {
    const received: string[] = [];
    deliverScriptMessage(MESSAGE, (body) => received.push(body), fakeWk(STRING_TYPE), readBody);
    expect(received).toEqual(['{"ping":"pong"}']);
  });

  test('drops a non-string body without reading it as a WKString', () => {
    const received: string[] = [];
    const readAsString = (): string => {
      throw new Error('read a non-string body as a WKString');
    };
    deliverScriptMessage(MESSAGE, (body) => received.push(body), fakeWk(DOUBLE_TYPE), readAsString);
    expect(received).toEqual([]);
  });
});

import { afterEach, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import type { BuiltProtocolResponse } from '../../../src/main/api/protocol';
import { nsString, nsStringToString } from '../../../src/main/platform/macos/cocoa-foundation';
import {
  msgSendPtr,
  msgSendReturnsI64,
} from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import { defineObjcClass } from '../../../src/main/platform/macos/cocoa-runtime-class';
import {
  createUrlSchemeHandler,
  handleStartTask,
  setUrlSchemeDispatcherForTesting,
} from '../../../src/main/platform/macos/cocoa-url-scheme-handler';
import type { Handle } from '../../../src/main/platform/macos/objc';

type TaskLog = {
  request: Handle;
  response: Handle;
  dataLength: bigint;
  finished: number;
  failed: number;
};

const log: TaskLog = { request: 0n, response: 0n, dataLength: -1n, finished: 0, failed: 0 };
let taskClass: Handle | undefined;

/** A stand-in `WKURLSchemeTask` that records what the handler drives it through. */
const fakeTask = (url: string): Handle => {
  const rt = cocoa();
  const retain = (h: Handle): Handle => rt.msgSend(h, rt.selectors.get('retain'));
  taskClass ??= defineObjcClass('BunmaskaTestSchemeTask', 'NSObject', [
    {
      selector: 'request',
      typeEncoding: '@@:',
      args: [],
      returns: 'object',
      impl: () => log.request,
    },
    {
      selector: 'didReceiveResponse:',
      typeEncoding: 'v@:@',
      args: ['object'],
      impl: (_self, _cmd, response) => {
        // WebKit keeps the response it is handed, so retain it the same way.
        log.response = retain(response);
      },
    },
    {
      selector: 'didReceiveData:',
      typeEncoding: 'v@:@',
      args: ['object'],
      impl: (_self, _cmd, data) => {
        log.dataLength = msgSendReturnsI64(data, rt.selectors.get('length'));
      },
    },
    {
      selector: 'didFinish',
      typeEncoding: 'v@:',
      args: [],
      impl: () => {
        log.finished += 1;
      },
    },
    {
      selector: 'didFailWithError:',
      typeEncoding: 'v@:@',
      args: ['object'],
      impl: () => {
        log.failed += 1;
      },
    },
  ]);
  const nsUrl = msgSendPtr(
    rt.classes.get('NSURL'),
    rt.selectors.get('URLWithString:'),
    nsString(url),
  );
  log.request = retain(
    msgSendPtr(rt.classes.get('NSURLRequest'), rt.selectors.get('requestWithURL:'), nsUrl),
  );
  log.response = 0n;
  log.dataLength = -1n;
  log.finished = 0;
  log.failed = 0;
  return rt.msgSend(rt.msgSend(taskClass, rt.selectors.get('alloc')), rt.selectors.get('init'));
};

const serve = (built: BuiltProtocolResponse | undefined): string[] => {
  const seen: string[] = [];
  setUrlSchemeDispatcherForTesting((url) => {
    seen.push(url);
    return built;
  });
  handleStartTask(fakeTask('app://host/index.html'));
  return seen;
};

const responseString = (selector: string): string =>
  nsStringToString(cocoa().msgSend(log.response, cocoa().selectors.get(selector)));

afterEach(() => {
  setUrlSchemeDispatcherForTesting(undefined);
});

if (currentPlatform() === 'macos') {
  describe('BunmaskaURLSchemeHandler task serving', () => {
    test('serves the dispatched body with its MIME type and length, then finishes', () => {
      const bytes = new TextEncoder().encode('<h1>hi</h1>');
      const seen = serve({ bytes, mimeType: 'text/html' });
      expect(seen).toEqual(['app://host/index.html']);
      expect(responseString('MIMEType')).toBe('text/html');
      const responseUrl = cocoa().msgSend(log.response, cocoa().selectors.get('URL'));
      expect(
        nsStringToString(cocoa().msgSend(responseUrl, cocoa().selectors.get('absoluteString'))),
      ).toBe('app://host/index.html');
      expect(msgSendReturnsI64(log.response, cocoa().selectors.get('expectedContentLength'))).toBe(
        BigInt(bytes.length),
      );
      expect(log.dataLength).toBe(BigInt(bytes.length));
      expect([log.finished, log.failed]).toEqual([1, 0]);
    });

    test('a charset parameter becomes the text encoding, not part of the MIME type', () => {
      serve({ bytes: new Uint8Array([65]), mimeType: 'text/html; charset="Shift_JIS"' });
      expect(responseString('MIMEType')).toBe('text/html');
      expect(responseString('textEncodingName')).toBe('Shift_JIS');
    });

    test('the handler does not keep its own reference to the response', () => {
      serve({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'application/octet-stream' });
      // Only the fake task's retain is left; a leaked +1 from alloc/init would make this 2.
      expect(msgSendReturnsI64(log.response, cocoa().selectors.get('retainCount'))).toBe(1n);
    });

    test('a declined request fails the task', () => {
      serve(undefined);
      expect([log.finished, log.failed]).toEqual([0, 1]);
    });
  });

  describe('createUrlSchemeHandler', () => {
    test('every window shares one handler instance instead of leaking one each', () => {
      expect(createUrlSchemeHandler().handle).toBe(createUrlSchemeHandler().handle);
    });
  });
}

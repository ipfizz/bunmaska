import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';
import { nsString } from '../../../src/main/platform/macos/cocoa-foundation';
import {
  msgSendPtr3,
  msgSendPtrI64Ptr,
  msgSendPtrPtr,
} from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { createNavigationDelegate } from '../../../src/main/platform/macos/cocoa-navigation-delegate';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import type { Handle } from '../../../src/main/platform/macos/objc';
import type { NativeApplication, NativeNavigationEvent } from '../../../src/main/platform/native';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const nsError = (domain: string, code: bigint): Handle => {
  const rt = cocoa();
  const info = msgSendPtrPtr(
    rt.classes.get('NSDictionary'),
    rt.selectors.get('dictionaryWithObject:forKey:'),
    nsString('boom'),
    nsString('NSLocalizedDescription'),
  );
  return msgSendPtrI64Ptr(
    rt.classes.get('NSError'),
    rt.selectors.get('errorWithDomain:code:userInfo:'),
    nsString(domain),
    code,
    info,
  );
};

const failWith = (domain: string, code: bigint): NativeNavigationEvent[] => {
  const seen: NativeNavigationEvent[] = [];
  const delegate = createNavigationDelegate((event) => seen.push(event));
  const sel = cocoa().selectors.get('webView:didFailNavigation:withError:');
  msgSendPtr3(delegate.handle, sel, 0n, 0n, nsError(domain, code));
  delegate.destroy();
  return seen;
};

if (currentPlatform() === 'macos') {
  describe('did-fail-load error codes', () => {
    test('a cancelled load reports Chromium ERR_ABORTED (-3), then stops loading', () => {
      expect(failWith('NSURLErrorDomain', -999n)).toEqual([
        { type: 'did-fail-load', errorCode: -3, errorDescription: 'boom' },
        { type: 'did-stop-loading' },
      ]);
    });

    test('common NSURLErrorDomain codes map to their Chromium net errors', () => {
      const codeOf = (code: bigint): number | undefined => {
        const [event] = failWith('NSURLErrorDomain', code);
        return event?.type === 'did-fail-load' ? event.errorCode : undefined;
      };
      expect([codeOf(-1003n), codeOf(-1001n), codeOf(-1009n)]).toEqual([-105, -7, -106]);
    });

    test('a code from another domain passes through unchanged', () => {
      const [event] = failWith('BunmaskaTestDomain', -999n);
      expect(event).toEqual({ type: 'did-fail-load', errorCode: -999, errorDescription: 'boom' });
    });
  });

  describe('did-finish-load fires on a real page load', () => {
    let app: NativeApplication;

    beforeAll(() => {
      app = createMacOSApplication();
      app.start();
    });

    afterAll(() => {
      app.quit();
    });

    test('onDidFinishLoad runs after loadHTML completes', async () => {
      const win = app.createWindow({ width: 400, height: 300, title: 'nav', show: true });
      let loads = 0;
      win.webContents.onNavigation((navEvent) => {
        if (navEvent.type !== 'did-finish-load') {
          return;
        }
        loads += 1;
      });
      win.webContents.loadHTML('<html><body>nav</body></html>', 'about:blank');
      const deadline = Date.now() + 4000;
      while (loads === 0 && Date.now() < deadline) {
        await delay(50);
      }
      win.close();
      expect(loads).toBeGreaterThan(0);
    });
  });
}

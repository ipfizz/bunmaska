import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { nsHTTPCookie } from '../../../src/main/platform/macos/cocoa-cookies';
import { nsStringToString } from '../../../src/main/platform/macos/cocoa-foundation';
import { msgSendReturnsU8 } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

const BASE = { name: 'n', value: 'v', domain: '.example.com', path: '/', secure: false };

if (currentPlatform() === 'macos') {
  describe('nsHTTPCookie', () => {
    test('carries httpOnly and defaults SameSite to lax as Electron does', () => {
      const rt = cocoa();
      const cookie = nsHTTPCookie({ ...BASE, httpOnly: true });
      expect(msgSendReturnsU8(cookie, rt.selectors.get('isHTTPOnly'))).toBe(1);
      expect(nsStringToString(rt.msgSend(cookie, rt.selectors.get('sameSitePolicy')))).toBe('lax');
    });

    test('leaves httpOnly off when not requested', () => {
      const cookie = nsHTTPCookie({ ...BASE, httpOnly: false });
      expect(msgSendReturnsU8(cookie, cocoa().selectors.get('isHTTPOnly'))).toBe(0);
    });
  });
}

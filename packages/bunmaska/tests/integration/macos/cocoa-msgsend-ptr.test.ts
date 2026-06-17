import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { msgSendPtr } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

if (currentPlatform() === 'macos') {
  describe('msgSendPtr — one-extra-pointer-arg variant', () => {
    test('[NSWindow performSelector:@selector(alloc)] returns an allocated instance', () => {
      const rt = cocoa();
      const nsWindow = rt.classes.get('NSWindow');
      const performSel = rt.selectors.get('performSelector:');
      const allocSel = rt.selectors.get('alloc');
      const releaseSel = rt.selectors.get('release');

      const result = msgSendPtr(nsWindow, performSel, allocSel);

      expect(result).not.toBe(0n);
      expect(result).not.toBe(nsWindow);

      rt.msgSend(result, releaseSel);
    });

    test('performSelector returning the receiver itself works for [NSObject self]', () => {
      const rt = cocoa();
      const nsObject = rt.classes.get('NSObject');
      const performSel = rt.selectors.get('performSelector:');
      const selfSel = rt.selectors.get('self');

      const returned = msgSendPtr(nsObject, performSel, selfSel);

      expect(returned).toBe(nsObject);
    });
  });
}

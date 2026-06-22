import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { msgSendReturnsU8 } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

if (currentPlatform() === 'macos') {
  describe('msgSendReturnsU8 — BOOL-returning, zero-extra-arg variant', () => {
    test('[NSObject_instance isProxy] returns 0 (NO)', () => {
      const rt = cocoa();
      const nsObject = rt.classes.get('NSObject');
      const allocSel = rt.selectors.get('alloc');
      const initSel = rt.selectors.get('init');
      const isProxySel = rt.selectors.get('isProxy');
      const releaseSel = rt.selectors.get('release');

      const allocated = rt.msgSend(nsObject, allocSel);
      const initialized = rt.msgSend(allocated, initSel);

      const result = msgSendReturnsU8(initialized, isProxySel);

      expect(result).toBe(0);

      rt.msgSend(initialized, releaseSel);
    });

    test('return value is a JS number (not bigint)', () => {
      const rt = cocoa();
      const nsObject = rt.classes.get('NSObject');
      const allocSel = rt.selectors.get('alloc');
      const isProxySel = rt.selectors.get('isProxy');

      const instance = rt.msgSend(nsObject, allocSel);
      expect(typeof msgSendReturnsU8(instance, isProxySel)).toBe('number');
    });
  });
}

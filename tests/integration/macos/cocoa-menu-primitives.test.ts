import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { nsString } from '../../../src/main/platform/macos/cocoa-foundation';
import {
  msgSendPtr,
  msgSendPtr3,
  msgSendReturnsI64,
} from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

if (currentPlatform() === 'macos') {
  describe('NSMenu primitives via the new msgSend variants', () => {
    test('a fresh NSMenu reports numberOfItems 0, and addItem increments it', () => {
      const rt = cocoa();
      const menu = rt.msgSend(
        rt.msgSend(rt.classes.get('NSMenu'), rt.selectors.get('alloc')),
        rt.selectors.get('init'),
      );
      expect(menu).not.toBe(0n);
      expect(msgSendReturnsI64(menu, rt.selectors.get('numberOfItems'))).toBe(0n);

      const item = msgSendPtr3(
        rt.msgSend(rt.classes.get('NSMenuItem'), rt.selectors.get('alloc')),
        rt.selectors.get('initWithTitle:action:keyEquivalent:'),
        nsString('Quit'),
        0n,
        nsString('q'),
      );
      expect(item).not.toBe(0n);

      msgSendPtr(menu, rt.selectors.get('addItem:'), item);
      expect(msgSendReturnsI64(menu, rt.selectors.get('numberOfItems'))).toBe(1n);
    });
  });
}

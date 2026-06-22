import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { msgSendI64 } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

if (currentPlatform() === 'macos') {
  describe('msgSendI64 — one-extra-i64-arg variant', () => {
    test('[NSNumber numberWithInteger:42] returns a non-zero NSNumber', () => {
      const rt = cocoa();
      const nsNumber = rt.classes.get('NSNumber');
      const sel = rt.selectors.get('numberWithInteger:');

      const result = msgSendI64(nsNumber, sel, 42n);

      expect(result).not.toBe(0n);
      expect(result).not.toBe(nsNumber);
    });

    test('negative integers are accepted', () => {
      const rt = cocoa();
      const nsNumber = rt.classes.get('NSNumber');
      const sel = rt.selectors.get('numberWithInteger:');

      const result = msgSendI64(nsNumber, sel, -123n);

      expect(result).not.toBe(0n);
    });
  });
}

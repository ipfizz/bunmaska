import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { msgSendU8 } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

if (currentPlatform() === 'macos') {
  describe('msgSendU8 — one-extra-u8-arg variant', () => {
    test('[NSNumber numberWithBool:1] returns a non-zero NSNumber instance', () => {
      const rt = cocoa();
      const nsNumber = rt.classes.get('NSNumber');
      const sel = rt.selectors.get('numberWithBool:');

      const result = msgSendU8(nsNumber, sel, 1);

      expect(result).not.toBe(0n);
      expect(result).not.toBe(nsNumber);
    });

    test('[NSNumber numberWithBool:0] and [NSNumber numberWithBool:1] both return non-zero', () => {
      const rt = cocoa();
      const nsNumber = rt.classes.get('NSNumber');
      const sel = rt.selectors.get('numberWithBool:');

      const yes = msgSendU8(nsNumber, sel, 1);
      const no = msgSendU8(nsNumber, sel, 0);

      expect(yes).not.toBe(0n);
      expect(no).not.toBe(0n);
    });
  });
}

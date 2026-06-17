import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { msgSendF64 } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

if (currentPlatform() === 'macos') {
  describe('msgSendF64 — one-extra-f64-arg variant', () => {
    test('[NSDate dateWithTimeIntervalSinceNow:0.5] returns a non-zero NSDate', () => {
      const rt = cocoa();
      const nsDate = rt.classes.get('NSDate');
      const sel = rt.selectors.get('dateWithTimeIntervalSinceNow:');

      const result = msgSendF64(nsDate, sel, 0.5);

      expect(result).not.toBe(0n);
      expect(result).not.toBe(nsDate);
    });

    test('two NSDates with different intervals are distinct objects', () => {
      const rt = cocoa();
      const nsDate = rt.classes.get('NSDate');
      const sel = rt.selectors.get('dateWithTimeIntervalSinceNow:');

      const soon = msgSendF64(nsDate, sel, 0.1);
      const later = msgSendF64(nsDate, sel, 100);

      expect(soon).not.toBe(0n);
      expect(later).not.toBe(0n);
      expect(later).not.toBe(soon);
    });
  });
}

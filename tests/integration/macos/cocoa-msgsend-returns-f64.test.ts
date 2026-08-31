import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  msgSendF64,
  msgSendReturnsF64,
} from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

if (currentPlatform() === 'macos') {
  describe('msgSendReturnsF64 - f64-RETURN variant', () => {
    test('[NSDate timeIntervalSince1970] round-trips the seconds passed in', () => {
      const rt = cocoa();
      const nsDate = rt.classes.get('NSDate');
      const epochSeconds = 1_700_000_000.5;

      const date = msgSendF64(
        nsDate,
        rt.selectors.get('dateWithTimeIntervalSince1970:'),
        epochSeconds,
      );
      expect(date).not.toBe(0n);

      const roundTripped = msgSendReturnsF64(date, rt.selectors.get('timeIntervalSince1970'));
      expect(roundTripped).toBeCloseTo(epochSeconds, 3);
    });
  });
}

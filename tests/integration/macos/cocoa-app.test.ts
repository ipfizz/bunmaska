import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  getDockBadge,
  setActivationPolicy,
  setDockBadge,
} from '../../../src/main/platform/macos/cocoa-app';
import {
  msgSendI64,
  msgSendReturnsI64,
} from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

if (currentPlatform() === 'macos') {
  describe('cocoa-app NSApplication operations', () => {
    test('setActivationPolicy applies the NSApplicationActivationPolicy value', () => {
      const rt = cocoa();
      const nsApp = rt.msgSend(
        rt.classes.get('NSApplication'),
        rt.selectors.get('sharedApplication'),
      );
      const policy = (): bigint => msgSendReturnsI64(nsApp, rt.selectors.get('activationPolicy'));
      const before = policy();
      try {
        setActivationPolicy('accessory');
        expect(policy()).toBe(1n);
      } finally {
        msgSendI64(nsApp, rt.selectors.get('setActivationPolicy:'), before);
      }
    });

    test('dock badge round-trips and clears', () => {
      setDockBadge('7');
      expect(getDockBadge()).toBe('7');
      setDockBadge('');
      expect(getDockBadge()).toBe('');
    });
  });
}

import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { getContentWorld, pageWorld } from '../../../src/main/platform/macos/cocoa-content-world';
import { loadWebKit } from '../../../src/main/platform/macos/cocoa-webkit';

if (currentPlatform() === 'macos') {
  describe('WKContentWorld', () => {
    test('the same name returns the same (interned + memoised) handle', () => {
      loadWebKit();
      const a = getContentWorld('BunmaskaPreload');
      const b = getContentWorld('BunmaskaPreload');
      expect(b).toBe(a);
    });

    test('a different name returns a different world handle', () => {
      loadWebKit();
      const preload = getContentWorld('BunmaskaPreload');
      const other = getContentWorld('SomethingElse');
      expect(other).not.toBe(preload);
    });

    test('pageWorld is non-zero and distinct from the named preload world', () => {
      loadWebKit();
      const page = pageWorld();
      expect(page).not.toBe(0n);
      expect(page).not.toBe(getContentWorld('BunmaskaPreload'));
    });
  });
}

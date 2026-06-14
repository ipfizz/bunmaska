import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  defaultClientWorld,
  getContentWorld,
  pageWorld,
  resetContentWorldCacheForTesting,
} from '../../../src/main/platform/macos/cocoa-content-world';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import { loadWebKit } from '../../../src/main/platform/macos/cocoa-webkit';

if (currentPlatform() === 'macos') {
  describe('WKContentWorld', () => {
    test('the class resolves via objc_getClass once WebKit is loaded', () => {
      loadWebKit();
      expect(cocoa().classes.get('WKContentWorld')).not.toBe(0n);
    });

    test('worldWithName: returns a non-zero world handle', () => {
      loadWebKit();
      resetContentWorldCacheForTesting();
      expect(getContentWorld('BunmaskaPreload')).not.toBe(0n);
    });

    test('the same name returns the same (interned + memoised) handle', () => {
      loadWebKit();
      resetContentWorldCacheForTesting();
      const a = getContentWorld('BunmaskaPreload');
      const b = getContentWorld('BunmaskaPreload');
      expect(b).toBe(a);
    });

    test('a different name returns a different world handle', () => {
      loadWebKit();
      resetContentWorldCacheForTesting();
      const preload = getContentWorld('BunmaskaPreload');
      const other = getContentWorld('SomethingElse');
      expect(other).not.toBe(preload);
    });

    test('pageWorld is non-zero and distinct from the named preload world', () => {
      loadWebKit();
      resetContentWorldCacheForTesting();
      const page = pageWorld();
      expect(page).not.toBe(0n);
      expect(page).not.toBe(getContentWorld('BunmaskaPreload'));
    });

    test('defaultClientWorld is non-zero', () => {
      loadWebKit();
      expect(defaultClientWorld()).not.toBe(0n);
    });
  });
}

import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import { loadWebKit } from '../../../src/main/platform/macos/cocoa-webkit';

if (currentPlatform() === 'macos') {
  describe('loadWebKit', () => {
    test('makes WKWebView resolvable via objc_getClass', () => {
      loadWebKit();
      expect(cocoa().classes.get('WKWebView')).not.toBe(0n);
    });

    test('makes WKWebViewConfiguration resolvable', () => {
      loadWebKit();
      expect(cocoa().classes.get('WKWebViewConfiguration')).not.toBe(0n);
    });

    test('makes WKUserContentController resolvable', () => {
      loadWebKit();
      expect(cocoa().classes.get('WKUserContentController')).not.toBe(0n);
    });

    test('is idempotent — repeated calls are safe', () => {
      loadWebKit();
      loadWebKit();
      expect(cocoa().classes.get('WKWebView')).not.toBe(0n);
    });
  });
}

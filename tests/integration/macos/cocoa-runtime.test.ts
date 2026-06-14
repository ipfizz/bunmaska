import { describe, expect, test } from 'bun:test';
import { BunmaskaError } from '../../../src/common/errors';
import { currentPlatform } from '../../../src/common/platform';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

if (currentPlatform() === 'macos') {
  describe('cocoa() runtime on macOS', () => {
    test('returns a runtime object exposing selectors, classes, and msgSend', () => {
      const rt = cocoa();
      expect(rt.selectors).toBeDefined();
      expect(rt.classes).toBeDefined();
      expect(typeof rt.msgSend).toBe('function');
    });

    test('returns the same runtime object across calls (singleton)', () => {
      expect(cocoa()).toBe(cocoa());
    });

    test('selectors.get returns a non-zero bigint for "alloc"', () => {
      const sel = cocoa().selectors.get('alloc');
      expect(typeof sel).toBe('bigint');
      expect(sel).not.toBe(0n);
    });

    test('selectors.get is cached — same name yields same bigint', () => {
      const a = cocoa().selectors.get('release');
      const b = cocoa().selectors.get('release');
      expect(b).toBe(a);
    });

    test('classes.get resolves NSObject to a non-zero bigint', () => {
      const cls = cocoa().classes.get('NSObject');
      expect(typeof cls).toBe('bigint');
      expect(cls).not.toBe(0n);
    });

    test('classes.get resolves NSString (proves Foundation is loaded)', () => {
      const cls = cocoa().classes.get('NSString');
      expect(cls).not.toBe(0n);
    });

    test('classes.get throws BunmaskaError for an unknown class', () => {
      expect(() => cocoa().classes.get('BunmaskaNonexistentClass_xyzxyz')).toThrow(BunmaskaError);
    });

    test('classes.get resolves NSWindow to a non-zero bigint', () => {
      const cls = cocoa().classes.get('NSWindow');
      expect(cls).not.toBe(0n);
    });

    test('msgSend(NSWindow, alloc) returns a non-zero allocated instance', () => {
      const rt = cocoa();
      const nsWindowClass = rt.classes.get('NSWindow');
      const allocSel = rt.selectors.get('alloc');

      const instance = rt.msgSend(nsWindowClass, allocSel);

      expect(instance).not.toBe(0n);
      expect(instance).not.toBe(nsWindowClass);
    });
  });
}

import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadCocoaFFI } from '../../../src/main/platform/macos/cocoa-ffi';
import { cstr } from '../../../src/main/platform/cstr';

if (currentPlatform() === 'macos') {
  describe('Cocoa FFI on macOS', () => {
    test('loadCocoaFFI opens the libraries once', () => {
      expect(loadCocoaFFI()).toBe(loadCocoaFFI());
    });

    test('sel_registerName returns a non-null selector for "alloc"', () => {
      const lib = loadCocoaFFI();
      const sel = lib.symbols.sel_registerName(cstr('alloc'));
      expect(sel).not.toBe(0n);
    });

    test('sel_registerName is idempotent - same name yields the same selector pointer', () => {
      const lib = loadCocoaFFI();
      const a = lib.symbols.sel_registerName(cstr('release'));
      const b = lib.symbols.sel_registerName(cstr('release'));
      expect(a).toBe(b);
    });

    test('objc_getClass resolves NSObject after Foundation is loaded', () => {
      const lib = loadCocoaFFI();
      const cls = lib.symbols.objc_getClass(cstr('NSObject'));
      expect(cls).not.toBe(0n);
    });

    test('objc_getClass resolves NSString after Foundation is loaded', () => {
      const lib = loadCocoaFFI();
      const cls = lib.symbols.objc_getClass(cstr('NSString'));
      expect(cls).not.toBe(0n);
    });

    test('objc_getClass returns 0n for an unknown class name', () => {
      const lib = loadCocoaFFI();
      const cls = lib.symbols.objc_getClass(cstr('BunmaskaNonexistentClass_xyzxyz'));
      expect(cls).toBe(0n);
    });

    test('objc_getClass resolves NSWindow after AppKit is loaded', () => {
      const lib = loadCocoaFFI();
      const cls = lib.symbols.objc_getClass(cstr('NSWindow'));
      expect(cls).not.toBe(0n);
    });

    test('objc_getClass resolves NSApplication after AppKit is loaded', () => {
      const lib = loadCocoaFFI();
      const cls = lib.symbols.objc_getClass(cstr('NSApplication'));
      expect(cls).not.toBe(0n);
    });
  });
}

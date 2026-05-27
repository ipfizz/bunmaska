import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadCocoaFFI } from '../../../src/main/platform/macos/cocoa-ffi';
import { cstr } from '../../../src/main/platform/macos/cstr';

if (currentPlatform() === 'macos') {
  describe('Cocoa FFI on macOS', () => {
    test('loadCocoaFFI returns a library handle with the three foundational symbols', () => {
      const lib = loadCocoaFFI();
      expect(typeof lib.symbols.sel_registerName).toBe('function');
      expect(typeof lib.symbols.objc_getClass).toBe('function');
      expect(typeof lib.symbols.objc_msgSend).toBe('function');
    });

    test('sel_registerName returns a non-null selector for "alloc"', () => {
      const lib = loadCocoaFFI();
      const sel = lib.symbols.sel_registerName(cstr('alloc'));
      expect(sel).not.toBeNull();
    });

    test('sel_registerName is idempotent — same name yields the same selector pointer', () => {
      const lib = loadCocoaFFI();
      const a = lib.symbols.sel_registerName(cstr('release'));
      const b = lib.symbols.sel_registerName(cstr('release'));
      expect(a).toBe(b);
    });
  });
}

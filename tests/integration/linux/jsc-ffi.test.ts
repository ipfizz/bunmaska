import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadJscFFI } from '../../../src/main/platform/linux/jsc-ffi';

if (currentPlatform() === 'linux') {
  describe('JavaScriptCoreGTK FFI on Linux', () => {
    // CI-RISK: confirms libjavascriptcoregtk-6.0.so.1 resolves separately.
    test('resolves jsc_value_to_string from the separate .so', () => {
      const lib = loadJscFFI();
      expect(typeof lib.symbols.jsc_value_to_string).toBe('function');
    });
  });
}

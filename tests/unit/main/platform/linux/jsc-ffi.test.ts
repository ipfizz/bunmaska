import { FFIType } from 'bun:ffi';
import { describe, expect, it } from 'bun:test';
import { JSC_FFI_SYMBOLS, loadJscFFI } from '../../../../../src/main/platform/linux/jsc-ffi';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';

describe('loadJscFFI', () => {
  it('throws UnsupportedPlatformError on non-Linux platforms', () => {
    if (currentPlatform() === 'linux') {
      return;
    }
    expect(() => loadJscFFI()).toThrow(UnsupportedPlatformError);
  });
});

describe('JSC_FFI_SYMBOLS (shape-only ABI assertions)', () => {
  it('declares jsc_value_to_string returning pointer (not cstring) so it can be freed', () => {
    expect(JSC_FFI_SYMBOLS.jsc_value_to_string.args).toEqual([FFIType.pointer]);
    expect(JSC_FFI_SYMBOLS.jsc_value_to_string.returns).toBe(FFIType.pointer);
  });
});

import { FFIType } from 'bun:ffi';
import { expect, test } from 'bun:test';
import { CARBON_FFI_SYMBOLS } from '../../../../../src/main/platform/macos/carbon-ffi';

// ItemCount and ByteCount are `unsigned long` (MacTypes.h): 64-bit, unlike the
// UInt32/OSType params beside them. A u32 leaves the callee's upper half to chance.
test('Carbon ItemCount and ByteCount params are u64', () => {
  expect(CARBON_FFI_SYMBOLS.InstallEventHandler.args[2]).toBe(FFIType.u64);
  expect(CARBON_FFI_SYMBOLS.GetEventParameter.args[4]).toBe(FFIType.u64);
});

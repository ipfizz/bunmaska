import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadKernel32, loadUser32 } from '../../../src/main/platform/windows/win32-ffi';

/** Windows-only: the DLLs open (dlopen throws on any missing symbol) and stay memoised. */
const isWindows = currentPlatform() === 'windows';

describe.skipIf(!isWindows)('Win32 FFI on Windows', () => {
  test('GetModuleHandleW(NULL) returns a non-null module handle', () => {
    const kernel32 = loadKernel32();
    // NULL module name returns the base address of the running executable.
    const hInstance = kernel32.symbols.GetModuleHandleW(null);
    expect(hInstance).not.toBe(0n);
  });

  test('loadUser32 is idempotent (same library handle)', () => {
    expect(loadUser32()).toBe(loadUser32());
  });
});

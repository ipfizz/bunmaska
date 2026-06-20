import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadKernel32, loadUser32 } from '../../../src/main/platform/windows/win32-ffi';

/**
 * Windows-only. Verifies user32.dll and kernel32.dll open and the windowing +
 * message-pump symbols resolve. We do NOT create a real window here (that is the
 * win32-window integration test); this asserts the FFI surface is present.
 */
const isWindows = currentPlatform() === 'windows';

describe.skipIf(!isWindows)('Win32 FFI on Windows', () => {
  test('loadUser32 resolves the window + message-pump symbols', () => {
    const user32 = loadUser32();
    expect(typeof user32.symbols.RegisterClassExW).toBe('function');
    expect(typeof user32.symbols.CreateWindowExW).toBe('function');
    expect(typeof user32.symbols.DefWindowProcW).toBe('function');
    expect(typeof user32.symbols.DestroyWindow).toBe('function');
    expect(typeof user32.symbols.PeekMessageW).toBe('function');
    expect(typeof user32.symbols.TranslateMessage).toBe('function');
    expect(typeof user32.symbols.DispatchMessageW).toBe('function');
  });

  test('loadKernel32 resolves GetModuleHandleW', () => {
    const kernel32 = loadKernel32();
    expect(typeof kernel32.symbols.GetModuleHandleW).toBe('function');
  });

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

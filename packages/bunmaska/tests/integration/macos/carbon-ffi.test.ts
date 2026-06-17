import { type Pointer, ptr } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadCarbonFFI } from '../../../src/main/platform/macos/carbon-ffi';

/**
 * macOS-only. Verifies the Carbon framework opens and the six hot-key/event
 * symbols resolve. We do NOT register a real hot key here (that is the backend's
 * integration test); this asserts the FFI surface is present and shaped.
 */
const isMac = currentPlatform() === 'macos';

describe.skipIf(!isMac)('Carbon FFI on macOS', () => {
  test('loadCarbonFFI resolves the hot-key + event symbols', () => {
    const carbon = loadCarbonFFI();
    expect(typeof carbon.symbols.RegisterEventHotKey).toBe('function');
    expect(typeof carbon.symbols.UnregisterEventHotKey).toBe('function');
    expect(typeof carbon.symbols.GetApplicationEventTarget).toBe('function');
    expect(typeof carbon.symbols.InstallEventHandler).toBe('function');
    expect(typeof carbon.symbols.GetEventParameter).toBe('function');
  });

  test('GetApplicationEventTarget returns a non-null event target', () => {
    const carbon = loadCarbonFFI();
    const target = carbon.symbols.GetApplicationEventTarget();
    expect(target).not.toBeNull();
  });

  test('loadCarbonFFI is idempotent (same library handle)', () => {
    expect(loadCarbonFFI()).toBe(loadCarbonFFI());
  });

  test('RegisterEventHotKey accepts a packed-u64 EventHotKeyID and returns noErr', () => {
    // This is the load-bearing struct-by-value workaround: the 8-byte
    // EventHotKeyID is passed in a single 64-bit register as a packed u64.
    const carbon = loadCarbonFFI();
    const target = carbon.symbols.GetApplicationEventTarget();
    const signature = 0x53414d42; // 'SAMB'
    const id = 99;
    const packed = BigInt(signature) | (BigInt(id) << 32n);
    const outRef = new BigInt64Array(1);
    // keyCode 0 (A), cmdKey modifier, options 0
    const rc = carbon.symbols.RegisterEventHotKey(0, 0x100, packed, target, 0, ptr(outRef));
    expect(rc).toBe(0); // noErr
    expect(outRef[0]).not.toBe(0n);
    if (outRef[0] !== 0n) {
      expect(carbon.symbols.UnregisterEventHotKey(Number(outRef[0]) as Pointer)).toBe(0);
    }
  });
});

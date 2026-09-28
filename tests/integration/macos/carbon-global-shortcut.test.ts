import { afterEach, describe, expect, test } from 'bun:test';
import { dlopen, FFIType, ptr } from 'bun:ffi';
import { currentPlatform } from '../../../src/common/platform';
import {
  macosGlobalShortcutBackend,
  registeredHotKeyId,
} from '../../../src/main/platform/macos/carbon-global-shortcut';
import { loadCarbonFFI } from '../../../src/main/platform/macos/carbon-ffi';

const SIGNATURE = 0x53414d42; // 'SAMB'
const HOT_KEY_ID = 0x686b6964; // 'hkid': both the parameter name and its type

/** Synthesize a kEventHotKeyPressed carrying `{signature, id}` and send it to the app target. */
const pressHotKey = (signature: number, id: number): number => {
  const carbon = dlopen('/System/Library/Frameworks/Carbon.framework/Carbon', {
    CreateEvent: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.f64, FFIType.u32, FFIType.ptr],
      returns: FFIType.i32,
    },
    SetEventParameter: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u64, FFIType.ptr],
      returns: FFIType.i32,
    },
    SendEventToEventTarget: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    ReleaseEvent: { args: [FFIType.ptr], returns: FFIType.void },
  });
  const KEYBOARD_EVENT_CLASS = 0x6b657962; // 'keyb'
  const K_EVENT_HOT_KEY_PRESSED = 6;
  const out = new BigUint64Array(1);
  carbon.symbols.CreateEvent(null, KEYBOARD_EVENT_CLASS, K_EVENT_HOT_KEY_PRESSED, 0, 0, ptr(out));
  const event = out[0] ?? 0n;
  const hotKeyId = new Uint32Array([signature, id]);
  carbon.symbols.SetEventParameter(event, HOT_KEY_ID, HOT_KEY_ID, 8n, ptr(hotKeyId));
  const status = carbon.symbols.SendEventToEventTarget(
    event,
    loadCarbonFFI().symbols.GetApplicationEventTarget(),
  );
  carbon.symbols.ReleaseEvent(event);
  carbon.close();
  return status;
};

// A real key press cannot be injected headlessly, so hot-key events are synthesized and sent
// straight to the application event target, which runs the same handler.
const isMac = currentPlatform() === 'macos';

describe.skipIf(!isMac)('carbon-global-shortcut (macOS)', () => {
  afterEach(() => {
    macosGlobalShortcutBackend.unregisterAll();
  });

  test('a hot-key press with our signature fires only that shortcut', () => {
    const fired: string[] = [];
    macosGlobalShortcutBackend.register('CmdOrCtrl+Shift+K', () => fired.push('K'));
    macosGlobalShortcutBackend.register('CmdOrCtrl+Shift+L', () => fired.push('L'));
    pressHotKey(SIGNATURE, registeredHotKeyId('CmdOrCtrl+Shift+L') ?? 0);
    expect(fired).toEqual(['L']);
  });

  test('a hot-key press with a foreign signature is left to other handlers', () => {
    let fired = false;
    macosGlobalShortcutBackend.register('CmdOrCtrl+Shift+K', () => {
      fired = true;
    });
    const EVENT_NOT_HANDLED_ERR = -9874;
    const status = pressHotKey(0x4f544852, registeredHotKeyId('CmdOrCtrl+Shift+K') ?? 0); // 'OTHR'
    expect(fired).toBe(false);
    expect(status).toBe(EVENT_NOT_HANDLED_ERR);
  });

  test('isSupported() is true on macOS', () => {
    expect(macosGlobalShortcutBackend.isSupported()).toBe(true);
  });

  test('register() a valid accelerator returns true without crashing', () => {
    expect(macosGlobalShortcutBackend.register('CmdOrCtrl+Shift+K', () => undefined)).toBe(true);
  });

  test('register() returns false for a key with no virtual-key mapping', () => {
    expect(macosGlobalShortcutBackend.register('CmdOrCtrl+F21', () => undefined)).toBe(false);
  });

  test('register() accepts Plus', () => {
    expect(macosGlobalShortcutBackend.register('CmdOrCtrl+Plus', () => undefined)).toBe(true);
  });

  test('unregister() of a live shortcut runs clean', () => {
    expect(macosGlobalShortcutBackend.register('CmdOrCtrl+Alt+J', () => undefined)).toBe(true);
    expect(() => macosGlobalShortcutBackend.unregister('CmdOrCtrl+Alt+J')).not.toThrow();
  });

  test('unregister() of an unknown accelerator is a clean no-op', () => {
    expect(() => macosGlobalShortcutBackend.unregister('CmdOrCtrl+Q')).not.toThrow();
  });

  test('registering, unregistering, and re-registering the same accelerator works', () => {
    expect(macosGlobalShortcutBackend.register('CmdOrCtrl+9', () => undefined)).toBe(true);
    macosGlobalShortcutBackend.unregister('CmdOrCtrl+9');
    expect(macosGlobalShortcutBackend.register('CmdOrCtrl+9', () => undefined)).toBe(true);
  });

  test('several distinct shortcuts register and unregisterAll cleanly', () => {
    expect(macosGlobalShortcutBackend.register('CmdOrCtrl+1', () => undefined)).toBe(true);
    expect(macosGlobalShortcutBackend.register('CmdOrCtrl+2', () => undefined)).toBe(true);
    expect(macosGlobalShortcutBackend.register('CmdOrCtrl+3', () => undefined)).toBe(true);
    expect(() => macosGlobalShortcutBackend.unregisterAll()).not.toThrow();
  });
});

import { afterEach, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { macosGlobalShortcutBackend } from '../../../src/main/platform/macos/carbon-global-shortcut';

/**
 * macOS-only. Exercises the REAL Carbon `RegisterEventHotKey` path on the host.
 *
 * Triggering a genuine system hot-key press headlessly is not reliably possible,
 * so — like the dialog/notification construction tests — this asserts the
 * register/unregister LIFECYCLE runs cleanly with no crash (no SIGSEGV from the
 * retained handler JSCallback or the packed-u64 EventHotKeyID), and that state is
 * tracked correctly. The packed-u64 struct-by-value workaround returning `noErr`
 * is what makes `register` return `true` here.
 */
const isMac = currentPlatform() === 'macos';

describe.skipIf(!isMac)('carbon-global-shortcut (macOS)', () => {
  afterEach(() => {
    macosGlobalShortcutBackend.unregisterAll();
  });

  test('isSupported() is true on macOS', () => {
    expect(macosGlobalShortcutBackend.isSupported()).toBe(true);
  });

  test('register() a valid accelerator returns true without crashing', () => {
    expect(macosGlobalShortcutBackend.register('CmdOrCtrl+Shift+K', () => undefined)).toBe(true);
  });

  test('register() returns false for a key with no virtual-key mapping', () => {
    expect(macosGlobalShortcutBackend.register('CmdOrCtrl+Plus', () => undefined)).toBe(false);
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

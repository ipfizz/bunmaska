import { afterEach, describe, expect, test } from 'bun:test';
import { dlopen, FFIType, type Pointer } from 'bun:ffi';
import { currentPlatform } from '../../../src/common/platform';
import { cstr } from '../../../src/main/platform/cstr';
import {
  linuxGlobalShortcutBackend,
  pollX11ShortcutsOnce,
} from '../../../src/main/platform/linux/x11-global-shortcut';
import { loadX11FFI } from '../../../src/main/platform/linux/x11-ffi';
import { CONTROL_MASK, SHIFT_MASK } from '../../../src/main/platform/linux/x11-keymap';

const hasDisplay = currentPlatform() === 'linux' && linuxGlobalShortcutBackend.isSupported();

/** XSync is not in the backend's table; a second client needs it to order its requests. */
const xSync = (dpy: Pointer): void => {
  dlopen('libX11.so.6', {
    XSync: { args: [FFIType.pointer, FFIType.i32], returns: FFIType.i32 },
  }).symbols.XSync(dpy, 0);
};

const loadXtst = () =>
  dlopen('libXtst.so.6', {
    XTestFakeKeyEvent: {
      args: [FFIType.pointer, FFIType.u32, FFIType.i32, FFIType.u64],
      returns: FFIType.i32,
    },
  }).symbols;

const xtst = ((): ReturnType<typeof loadXtst> | null => {
  try {
    return hasDisplay ? loadXtst() : null;
  } catch {
    return null;
  }
})();

/** A second X client, independent of the backend's grab connection. */
const openOtherClient = (): Pointer => {
  const dpy = loadX11FFI().symbols.XOpenDisplay(null);
  if (dpy === null) {
    throw new Error('XOpenDisplay failed for the second client');
  }
  return dpy;
};

const pumpShortcuts = async (until: () => boolean): Promise<void> => {
  for (let i = 0; i < 50 && !until(); i += 1) {
    pollX11ShortcutsOnce();
    await Bun.sleep(10);
  }
};

describe.skipIf(!hasDisplay)('x11-global-shortcut under an X server', () => {
  afterEach(() => {
    linuxGlobalShortcutBackend.unregisterAll();
  });

  test('register() grabs a letter combo', () => {
    expect(linuxGlobalShortcutBackend.register('CmdOrCtrl+Shift+K', () => undefined)).toBe(true);
  });

  test('register() grabs a punctuation key', () => {
    expect(linuxGlobalShortcutBackend.register('CmdOrCtrl+,', () => undefined)).toBe(true);
  });

  test('register() refuses a second spelling of a held combo', () => {
    expect(linuxGlobalShortcutBackend.register('Ctrl+K', () => undefined)).toBe(true);
    expect(linuxGlobalShortcutBackend.register('Control+K', () => undefined)).toBe(false);
  });

  test('register() returns false for an unmappable key', () => {
    expect(linuxGlobalShortcutBackend.register('CmdOrCtrl+Bogus', () => undefined)).toBe(false);
  });

  test('unregister() releases the combo so it can be registered again', () => {
    expect(linuxGlobalShortcutBackend.register('CmdOrCtrl+Alt+J', () => undefined)).toBe(true);
    linuxGlobalShortcutBackend.unregister('CmdOrCtrl+Alt+J');
    expect(linuxGlobalShortcutBackend.register('CmdOrCtrl+Alt+J', () => undefined)).toBe(true);
  });

  test('unregisterAll() releases every combo', () => {
    expect(linuxGlobalShortcutBackend.register('CmdOrCtrl+1', () => undefined)).toBe(true);
    expect(linuxGlobalShortcutBackend.register('CmdOrCtrl+2', () => undefined)).toBe(true);
    linuxGlobalShortcutBackend.unregisterAll();
    expect(linuxGlobalShortcutBackend.register('CmdOrCtrl+1', () => undefined)).toBe(true);
  });

  test('pollX11ShortcutsOnce() drains cleanly with no pending events', () => {
    expect(() => pollX11ShortcutsOnce()).not.toThrow();
  });

  test('a key another client already grabbed does not exit the process', async () => {
    const x11 = loadX11FFI().symbols;
    const other = openOtherClient();
    try {
      const keycode = x11.XKeysymToKeycode(other, x11.XStringToKeysym(cstr('j')));
      const mods = CONTROL_MASK | SHIFT_MASK;
      x11.XGrabKey(other, keycode, mods, x11.XDefaultRootWindow(other), 0, 1, 1);
      xSync(other);
      linuxGlobalShortcutBackend.register('Ctrl+Shift+J', () => undefined);
      await pumpShortcuts(() => false);
      expect(() => pollX11ShortcutsOnce()).not.toThrow();
    } finally {
      x11.XCloseDisplay(other);
    }
  });

  test.skipIf(xtst === null)('a faked Ctrl+K fires its callback once', async () => {
    let fired = 0;
    expect(
      linuxGlobalShortcutBackend.register('Ctrl+K', () => {
        fired += 1;
      }),
    ).toBe(true);
    const x11 = loadX11FFI().symbols;
    const other = openOtherClient();
    try {
      const ctrl = x11.XKeysymToKeycode(other, x11.XStringToKeysym(cstr('Control_L')));
      const k = x11.XKeysymToKeycode(other, x11.XStringToKeysym(cstr('k')));
      for (const [keycode, press] of [
        [ctrl, 1],
        [k, 1],
        [k, 0],
        [ctrl, 0],
      ] as const) {
        xtst?.XTestFakeKeyEvent(other, keycode, press, 0n);
      }
      xSync(other);
      await pumpShortcuts(() => fired > 0);
      expect(fired).toBe(1);
    } finally {
      x11.XCloseDisplay(other);
    }
  });
});

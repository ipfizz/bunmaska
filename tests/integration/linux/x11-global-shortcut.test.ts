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

/**
 * Linux-only. Exercises the REAL Xlib `XGrabKey` path. Needs an X server — under
 * `xvfb-run bun test` `XOpenDisplay` succeeds; on a host with no `$DISPLAY` the
 * backend honestly reports `isSupported() === false` and every test that needs a
 * display is skipped, NOT faked.
 *
 * Triggering a real KeyPress is not done here (it would need XTEST/XInput and a
 * grabbed focus); we assert the grab lifecycle runs without throwing and that the
 * poll drains cleanly. Wayland is out of scope (XGrabKey is X11-only).
 */
const isLinux = currentPlatform() === 'linux';

/** XSync is not in the backend's table; a second client needs it to order its grab first. */
const xSync = (dpy: Pointer): void => {
  dlopen('libX11.so.6', {
    XSync: { args: [FFIType.pointer, FFIType.i32], returns: FFIType.i32 },
  }).symbols.XSync(dpy, 0);
};

/** Open a second X client, independent of the backend's grab connection. */
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

const hasDisplay = (): boolean => {
  if (!isLinux) {
    return false;
  }
  try {
    return linuxGlobalShortcutBackend.isSupported();
  } catch {
    return false;
  }
};

describe.skipIf(!isLinux)('x11-global-shortcut (Linux)', () => {
  afterEach(() => {
    if (hasDisplay()) {
      linuxGlobalShortcutBackend.unregisterAll();
    }
  });

  test('Xlib symbols resolve', () => {
    const x11 = loadX11FFI();
    expect(typeof x11.symbols.XOpenDisplay).toBe('function');
    expect(typeof x11.symbols.XGrabKey).toBe('function');
    expect(typeof x11.symbols.XUngrabKey).toBe('function');
    expect(typeof x11.symbols.XNextEvent).toBe('function');
  });

  test('isSupported() returns a boolean reflecting whether a display opened', () => {
    expect(typeof linuxGlobalShortcutBackend.isSupported()).toBe('boolean');
  });

  describe.skipIf(!hasDisplay())('with an X display (xvfb)', () => {
    test('register() a valid accelerator grabs without throwing and returns true', () => {
      expect(linuxGlobalShortcutBackend.register('CmdOrCtrl+Shift+K', () => undefined)).toBe(true);
    });

    test('register() grabs a punctuation key', () => {
      expect(linuxGlobalShortcutBackend.register('CmdOrCtrl+,', () => undefined)).toBe(true);
    });

    test('register() returns false for an unmappable key', () => {
      expect(linuxGlobalShortcutBackend.register('CmdOrCtrl+Bogus', () => undefined)).toBe(false);
    });

    test('unregister() of a live grab runs clean', () => {
      expect(linuxGlobalShortcutBackend.register('CmdOrCtrl+Alt+J', () => undefined)).toBe(true);
      expect(() => linuxGlobalShortcutBackend.unregister('CmdOrCtrl+Alt+J')).not.toThrow();
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

    test('register/unregisterAll several grabs cleanly', () => {
      expect(linuxGlobalShortcutBackend.register('CmdOrCtrl+1', () => undefined)).toBe(true);
      expect(linuxGlobalShortcutBackend.register('CmdOrCtrl+2', () => undefined)).toBe(true);
      expect(() => linuxGlobalShortcutBackend.unregisterAll()).not.toThrow();
    });
  });
});

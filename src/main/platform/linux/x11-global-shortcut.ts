import { type Pointer, ptr } from 'bun:ffi';
import { parseAccelerator } from '../../api/accelerator';
import type { GlobalShortcutBackend } from '../../api/global-shortcut';
import { cstr } from '../cstr';
import { loadX11FFI } from './x11-ffi';
import {
  KEY_PRESS,
  KEY_PRESS_MASK,
  x11KeysymName,
  x11ModifierMask,
  XEVENT_BUFFER_SIZE,
  XEVENT_TYPE_OFFSET,
  XKEY_KEYCODE_OFFSET,
} from './x11-keymap';

/**
 * Linux `globalShortcut` backend via Xlib `XGrabKey` (X11 only, BEST-EFFORT).
 *
 * On X11 we open a DEDICATED display connection, grab each accelerator's
 * keycode+modifier on the root window, and poll that connection for `KeyPress`
 * events from {@link pollX11ShortcutsOnce} (wired into the Linux cooperative
 * pump's drain). A fired `KeyPress` is matched back to its registration by
 * keycode+modifier and the JS callback is dispatched.
 *
 * HONEST LIMITS:
 * - WAYLAND IS UNSUPPORTED in v1. `XGrabKey` only governs the X server; under a
 *   Wayland compositor (even via XWayland) a global grab does not see keys routed
 *   to native Wayland clients. True global shortcuts on Wayland require the
 *   `org.freedesktop.portal.GlobalShortcuts` portal — a separate, deferred path.
 * - If `XOpenDisplay` fails (no X server / headless without xvfb), the backend
 *   reports `isSupported() === false` and `register` returns `false` — it does
 *   NOT fake success.
 * - `XGrabKey` here grabs ONLY the exact modifier combo; it does not add the
 *   Lock/NumLock variants, so a shortcut may not fire while CapsLock/NumLock is
 *   on. That refinement is deferred.
 */

type Registration = {
  readonly keycode: number;
  readonly modifiers: number;
  readonly callback: () => void;
};

let display: Pointer | null | undefined;
let displayFailed = false;
let rootWindow = 0n;
const registrations: Registration[] = [];

/** Open (once) the dedicated X display for grabs, or record that it is unavailable. */
const ensureDisplay = (): Pointer | null => {
  if (display !== undefined) {
    return display;
  }
  if (displayFailed) {
    return null;
  }
  try {
    const x11 = loadX11FFI();
    const dpy = x11.symbols.XOpenDisplay(null);
    if (dpy === null) {
      displayFailed = true;
      return null;
    }
    display = dpy;
    rootWindow = x11.symbols.XDefaultRootWindow(dpy);
    x11.symbols.XSelectInput(dpy, rootWindow, KEY_PRESS_MASK);
    return dpy;
  } catch {
    displayFailed = true;
    return null;
  }
};

const register = (accelerator: string, callback: () => void): boolean => {
  const parsed = parseAccelerator(accelerator, 'linux');
  if (parsed === undefined) {
    return false;
  }
  const keysymName = x11KeysymName(parsed.key);
  if (keysymName === undefined) {
    return false;
  }
  const dpy = ensureDisplay();
  if (dpy === null) {
    return false;
  }
  const x11 = loadX11FFI();
  const keysym = x11.symbols.XStringToKeysym(cstr(keysymName));
  if (keysym === 0n) {
    return false;
  }
  const keycode = x11.symbols.XKeysymToKeycode(dpy, keysym);
  if (keycode === 0) {
    return false;
  }
  const modifiers = x11ModifierMask(parsed);
  // owner_events FALSE(0), pointer_mode/keyboard_mode GrabModeAsync(1).
  x11.symbols.XGrabKey(dpy, keycode, modifiers, rootWindow, 0, 1, 1);
  x11.symbols.XFlush(dpy);
  registrations.push({ keycode, modifiers, callback });
  return true;
};

const matches = (reg: Registration, accelerator: string): boolean => {
  const parsed = parseAccelerator(accelerator, 'linux');
  if (parsed === undefined) {
    return false;
  }
  const dpy = display;
  if (dpy === null || dpy === undefined) {
    return false;
  }
  const keysymName = x11KeysymName(parsed.key);
  if (keysymName === undefined) {
    return false;
  }
  const x11 = loadX11FFI();
  const keysym = x11.symbols.XStringToKeysym(cstr(keysymName));
  const keycode = x11.symbols.XKeysymToKeycode(dpy, keysym);
  return reg.keycode === keycode && reg.modifiers === x11ModifierMask(parsed);
};

const unregister = (accelerator: string): void => {
  const dpy = display;
  if (dpy === null || dpy === undefined) {
    return;
  }
  const x11 = loadX11FFI();
  for (let i = registrations.length - 1; i >= 0; i -= 1) {
    const reg = registrations[i];
    if (reg !== undefined && matches(reg, accelerator)) {
      x11.symbols.XUngrabKey(dpy, reg.keycode, reg.modifiers, rootWindow);
      registrations.splice(i, 1);
    }
  }
  x11.symbols.XFlush(dpy);
};

const unregisterAll = (): void => {
  const dpy = display;
  if (dpy === null || dpy === undefined) {
    registrations.length = 0;
    return;
  }
  const x11 = loadX11FFI();
  for (const reg of registrations) {
    x11.symbols.XUngrabKey(dpy, reg.keycode, reg.modifiers, rootWindow);
  }
  registrations.length = 0;
  x11.symbols.XFlush(dpy);
};

/**
 * Drain pending `KeyPress` events from the dedicated grab connection and fire the
 * matching callbacks. Wired into the Linux cooperative pump so registered hot
 * keys dispatch without blocking. No-op when no display is open.
 */
export const pollX11ShortcutsOnce = (): void => {
  const dpy = display;
  if (dpy === null || dpy === undefined) {
    return;
  }
  const x11 = loadX11FFI();
  const buffer = new Uint8Array(XEVENT_BUFFER_SIZE);
  const view = new DataView(buffer.buffer);
  let budget = 64;
  while (budget > 0 && x11.symbols.XPending(dpy) > 0) {
    budget -= 1;
    x11.symbols.XNextEvent(dpy, ptr(buffer));
    if (view.getInt32(XEVENT_TYPE_OFFSET, true) !== KEY_PRESS) {
      continue;
    }
    const keycode = view.getUint32(XKEY_KEYCODE_OFFSET, true);
    for (const reg of registrations) {
      if (reg.keycode === keycode) {
        reg.callback();
      }
    }
  }
};

/** Linux is supported only when a real X display connection can be opened. */
const isSupported = (): boolean => ensureDisplay() !== null;

/** The Linux X11 global-shortcut backend (X11 only; Wayland deferred). */
export const linuxGlobalShortcutBackend: GlobalShortcutBackend = {
  isSupported,
  register,
  unregister,
  unregisterAll,
};

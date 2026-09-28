import { CFunction, JSCallback, type Pointer, ptr } from 'bun:ffi';
import { parseAccelerator } from '../../api/accelerator';
import type { GlobalShortcutBackend } from '../../api/global-shortcut';
import { cstr } from '../cstr';
import { loadX11FFI } from './x11-ffi';
import {
  KEY_PRESS,
  x11KeysymName,
  x11ModifierMask,
  XEVENT_BUFFER_SIZE,
  XEVENT_TYPE_OFFSET,
  XKEY_KEYCODE_OFFSET,
  GRAB_VARIANTS,
  x11StateMatches,
  XKEY_STATE_OFFSET,
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

type Grab = { readonly keycode: number; readonly modifiers: number };
type Registration = Grab & { readonly callback: () => void };

let display: Pointer | null | undefined;
let displayFailed = false;
let rootWindow = 0n;
const registrations: Registration[] = [];
const eventBuffer = new Uint8Array(XEVENT_BUFFER_SIZE);
const eventView = new DataView(eventBuffer.buffer);
let errorTrap: JSCallback | undefined;

/**
 * Swallow X errors on the grab display: a BadAccess for a key another client holds
 * would otherwise reach Xlib's default handler, which exit(1)s the app. Errors on
 * any other display chain to the previous handler. Never closed (Xlib keeps the pointer).
 */
const installErrorTrap = (x11: ReturnType<typeof loadX11FFI>): void => {
  let previous: CallableFunction | undefined;
  errorTrap = new JSCallback(
    (dpy: Pointer | null, event: Pointer | null): number =>
      dpy === display || previous === undefined ? 0 : Number(previous(dpy, event)),
    { args: ['ptr', 'ptr'], returns: 'i32' },
  );
  const prior = x11.symbols.XSetErrorHandler(errorTrap.ptr);
  if (prior !== null) {
    previous = CFunction({ ptr: prior, args: ['ptr', 'ptr'], returns: 'i32' });
  }
};

/** XWayland root grabs never see keys routed to native Wayland clients, so Wayland is unsupported. */
export const isWaylandSession = (env: Readonly<Record<string, string | undefined>>): boolean =>
  Boolean(env['WAYLAND_DISPLAY']) || env['XDG_SESSION_TYPE'] === 'wayland';

/** Open (once) the dedicated X display for grabs, or record that it is unavailable. */
const ensureDisplay = (): Pointer | null => {
  if (display !== undefined) {
    return display;
  }
  if (displayFailed) {
    return null;
  }
  if (isWaylandSession(process.env)) {
    displayFailed = true;
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
    installErrorTrap(x11);
    rootWindow = x11.symbols.XDefaultRootWindow(dpy);
    return dpy;
  } catch {
    displayFailed = true;
    return null;
  }
};

/** The keycode+modifier combo `accelerator` grabs, or undefined when X cannot express it. */
const resolveGrab = (accelerator: string, dpy: Pointer): Grab | undefined => {
  const parsed = parseAccelerator(accelerator, 'linux');
  const keysymName = parsed === undefined ? undefined : x11KeysymName(parsed.key);
  if (parsed === undefined || keysymName === undefined) {
    return undefined;
  }
  const x11 = loadX11FFI();
  const keysym = x11.symbols.XStringToKeysym(cstr(keysymName));
  const keycode = keysym === 0n ? 0 : x11.symbols.XKeysymToKeycode(dpy, keysym);
  return keycode === 0 ? undefined : { keycode, modifiers: x11ModifierMask(parsed) };
};

const findRegistration = (grab: Grab): number =>
  registrations.findIndex((r) => r.keycode === grab.keycode && r.modifiers === grab.modifiers);

const ungrab = (dpy: Pointer, grab: Grab): void => {
  const x11 = loadX11FFI();
  for (const lockBits of GRAB_VARIANTS) {
    x11.symbols.XUngrabKey(dpy, grab.keycode, grab.modifiers | lockBits, rootWindow);
  }
};

const register = (accelerator: string, callback: () => void): boolean => {
  const dpy = ensureDisplay();
  const grab = dpy === null ? undefined : resolveGrab(accelerator, dpy);
  if (dpy === null || grab === undefined || findRegistration(grab) !== -1) {
    return false;
  }
  const x11 = loadX11FFI();
  // owner_events FALSE(0), pointer_mode/keyboard_mode GrabModeAsync(1).
  for (const lockBits of GRAB_VARIANTS) {
    x11.symbols.XGrabKey(dpy, grab.keycode, grab.modifiers | lockBits, rootWindow, 0, 1, 1);
  }
  // ponytail: a key another client holds still returns true; XSync + a trap flag reports it once x11-ffi declares XSync.
  x11.symbols.XFlush(dpy);
  registrations.push({ ...grab, callback });
  return true;
};

const unregister = (accelerator: string): void => {
  const dpy = display;
  const grab = dpy === null || dpy === undefined ? undefined : resolveGrab(accelerator, dpy);
  if (dpy === null || dpy === undefined || grab === undefined) {
    return;
  }
  const index = findRegistration(grab);
  if (index === -1) {
    return;
  }
  registrations.splice(index, 1);
  ungrab(dpy, grab);
  loadX11FFI().symbols.XFlush(dpy);
};

const unregisterAll = (): void => {
  const dpy = display;
  if (dpy !== null && dpy !== undefined) {
    for (const reg of registrations) {
      ungrab(dpy, reg);
    }
    loadX11FFI().symbols.XFlush(dpy);
  }
  registrations.length = 0;
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
  let budget = 64;
  while (budget > 0 && x11.symbols.XPending(dpy) > 0) {
    budget -= 1;
    x11.symbols.XNextEvent(dpy, ptr(eventBuffer));
    if (eventView.getInt32(XEVENT_TYPE_OFFSET, true) !== KEY_PRESS) {
      continue;
    }
    const keycode = eventView.getUint32(XKEY_KEYCODE_OFFSET, true);
    const state = eventView.getUint32(XKEY_STATE_OFFSET, true);
    for (const reg of registrations) {
      // Keycode alone once dispatched here, so Ctrl+K fired Ctrl+Shift+K too.
      if (reg.keycode === keycode && x11StateMatches(state, reg.modifiers)) {
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

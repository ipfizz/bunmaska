import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * Xlib FFI for the Linux `globalShortcut` backend (`XGrabKey`).
 *
 * Loaded only on Linux. On X11 we open a DEDICATED display connection, grab each
 * accelerator's keycode+modifier combo on the root window with `XGrabKey`, and
 * poll that connection for `KeyPress` events from the cooperative pump. Wayland
 * is NOT supported in v1 — global shortcuts there require the
 * `org.freedesktop.portal.GlobalShortcuts` desktop portal, which is deferred.
 *
 * `XEvent` is a ~192-byte union; we never marshal it as a struct — we allocate a
 * byte buffer, let `XNextEvent` fill it, and read the `type` (int at offset 0)
 * and, for `XKeyEvent`, the `keycode` field by offset.
 */

const LIBX11_PATH = 'libX11.so.6';

/** The Xlib symbol descriptor table. */
export const X11_FFI_SYMBOLS = {
  // (const char *display_name) -> Display*   (NULL = $DISPLAY)
  XOpenDisplay: { args: [FFIType.cstring], returns: FFIType.pointer },
  // (Display*) -> int
  XCloseDisplay: { args: [FFIType.pointer], returns: FFIType.i32 },
  // (Display*) -> Window (XID, unsigned long)
  XDefaultRootWindow: { args: [FFIType.pointer], returns: FFIType.u64 },
  // (Display*, KeySym) -> KeyCode (unsigned char)
  XKeysymToKeycode: { args: [FFIType.pointer, FFIType.u64], returns: FFIType.u8 },
  // (const char *string) -> KeySym (unsigned long)
  XStringToKeysym: { args: [FFIType.cstring], returns: FFIType.u64 },
  // (Display*, int keycode, unsigned int modifiers, Window grab_window,
  //  Bool owner_events, int pointer_mode, int keyboard_mode) -> int
  XGrabKey: {
    args: [
      FFIType.pointer,
      FFIType.i32,
      FFIType.u32,
      FFIType.u64,
      FFIType.i32,
      FFIType.i32,
      FFIType.i32,
    ],
    returns: FFIType.i32,
  },
  // (Display*, int keycode, unsigned int modifiers, Window grab_window) -> int
  XUngrabKey: {
    args: [FFIType.pointer, FFIType.i32, FFIType.u32, FFIType.u64],
    returns: FFIType.i32,
  },
  // (Display*, Window, long event_mask) -> int
  XSelectInput: { args: [FFIType.pointer, FFIType.u64, FFIType.i64], returns: FFIType.i32 },
  // (Display*) -> int
  XPending: { args: [FFIType.pointer], returns: FFIType.i32 },
  // (Display*, XEvent *event_return) -> int
  XNextEvent: { args: [FFIType.pointer, FFIType.pointer], returns: FFIType.i32 },
  // (Display*) -> int
  XFlush: { args: [FFIType.pointer], returns: FFIType.i32 },
  // (int (*handler)(Display*, XErrorEvent*)) -> previous handler  (we pass a no-op)
  XSetErrorHandler: { args: [FFIType.pointer], returns: FFIType.pointer },
} as const;

const cache: { ffi: ReturnType<typeof dlopen<typeof X11_FFI_SYMBOLS>> | undefined } = {
  ffi: undefined,
};

/**
 * Open `libX11.so.6` and return the Xlib symbol table. Memoised; throws
 * {@link UnsupportedPlatformError} off Linux so the module stays importable on
 * macOS for unit testing.
 */
export const loadX11FFI = () => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `loadX11FFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
  if (cache.ffi) {
    return cache.ffi;
  }
  const ffi = dlopen(LIBX11_PATH, X11_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};

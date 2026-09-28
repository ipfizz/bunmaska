import { FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import { dlopenLinux } from './glib-ffi';

const LIBX11_PATH = 'libX11.so.6';

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
  // (Display*) -> int
  XPending: { args: [FFIType.pointer], returns: FFIType.i32 },
  // (Display*, XEvent* out) -> int. XEvent is a 192-byte union: pass a byte buffer and read
  //  fields by offset, never marshal it as a struct.
  XNextEvent: { args: [FFIType.pointer, FFIType.pointer], returns: FFIType.i32 },
  // (Display*) -> int
  XFlush: { args: [FFIType.pointer], returns: FFIType.i32 },
  // (Display*, Bool discard) -> int. A round trip: every error for earlier requests has
  //  reached the error handler when it returns, so a refused XGrabKey is known synchronously.
  XSync: { args: [FFIType.pointer, FFIType.i32], returns: FFIType.i32 },
  // (int (*handler)(Display*, XErrorEvent*)) -> previous handler. Without one, a BadAccess
  //  from XGrabKey reaches Xlib's default handler, which exit(1)s the app.
  XSetErrorHandler: { args: [FFIType.pointer], returns: FFIType.pointer },
} as const;

const cache: { ffi: ReturnType<typeof dlopenLinux<typeof X11_FFI_SYMBOLS>> | undefined } = {
  ffi: undefined,
};

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
  const ffi = dlopenLinux(LIBX11_PATH, X11_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};

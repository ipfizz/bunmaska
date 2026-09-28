import { FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import { dlopenLinux } from './glib-ffi';

const LIBNOTIFY_PATH = 'libnotify.so.4';

export const LIBNOTIFY_FFI_SYMBOLS = {
  // (app_name) -> gboolean; call once per process before creating notifications.
  notify_init: {
    args: [FFIType.cstring],
    returns: FFIType.i32,
  },
  notify_is_initted: {
    args: [],
    returns: FFIType.i32,
  },
  // (summary, body, icon) -> NotifyNotification*; body/icon may be NULL.
  notify_notification_new: {
    args: [FFIType.cstring, FFIType.cstring, FFIType.cstring],
    returns: FFIType.pointer,
  },
  // (notification, GError** /*null*/) -> gboolean (FALSE if no daemon).
  notify_notification_show: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.i32,
  },
  // (notification, GError** /*null*/) -> gboolean.
  notify_notification_close: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.i32,
  },
  // (NotifyNotification*, const char* key, GVariant* value) -> void; sinks the floating variant
  notify_notification_set_hint: {
    args: [FFIType.pointer, FFIType.cstring, FFIType.pointer],
    returns: FFIType.void,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopenLinux<typeof LIBNOTIFY_FFI_SYMBOLS>> | undefined } = {
  ffi: undefined,
};

export const loadLibnotifyFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `loadLibnotifyFFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
  if (cache.ffi) {
    return cache.ffi;
  }
  const ffi = dlopenLinux(LIBNOTIFY_PATH, LIBNOTIFY_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};

import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * Loads the libnotify symbols behind Sambar's `Notification` API on Linux.
 *
 * libnotify is the freedesktop desktop-notification client library; it forwards
 * to the session's notification daemon over D-Bus. CI runs headless (xvfb) with
 * NO notification daemon, so `notify_notification_show` may return FALSE / no-op
 * there — that is EXPECTED. The integration test therefore asserts only that the
 * symbols resolve, `notify_init` runs, and construct/show/close do not throw; it
 * does NOT assert a banner appeared.
 *
 * Declared separately from {@link loadLibnotifyFFI} so unit tests can assert ABI
 * shapes (arg arrays, return types) without `dlopen` on a non-Linux host.
 *
 * Convention (matches the existing Linux loaders): `gboolean` is modelled as
 * {@link FFIType.i32} (compare `!== 0`); the `NotifyNotification*` handle and the
 * `GError**` out-param are real pointers ({@link FFIType.pointer}); `cstring`
 * args are NUL-terminated UTF-8 strings. The `GError**` arg is always passed as
 * `null` (failures are reported via the gboolean return, not unwrapped).
 *
 * Only callable on Linux — throws {@link UnsupportedPlatformError} otherwise so
 * the module stays safely importable on macOS for unit testing.
 */

const LIBNOTIFY_PATH = 'libnotify.so.4';

/** The libnotify FFI symbol descriptor table (from `libnotify.so.4`). */
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
  // (notification, timeout_ms) -> void; -1 = default, 0 = never expire.
  notify_notification_set_timeout: {
    args: [FFIType.pointer, FFIType.i32],
    returns: FFIType.void,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopen<typeof LIBNOTIFY_FFI_SYMBOLS>> | undefined } = {
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
  const ffi = dlopen(LIBNOTIFY_PATH, LIBNOTIFY_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};

import { FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import { dlopenLinux } from './glib-ffi';

const LIBGIO_PATH = 'libgio-2.0.so.0';

export const GIO_FFI_SYMBOLS = {
  g_app_info_launch_default_for_uri: {
    args: [FFIType.cstring, FFIType.pointer, FFIType.pointer],
    returns: FFIType.i32,
  },
  // (GFile*) -> char* local path (transfer-full: g_free; NULL when not native).
  g_file_get_path: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (const char* path) -> GFile* (transfer-full: g_object_unref). Never fails, even for a missing path.
  g_file_new_for_path: {
    args: [FFIType.cstring],
    returns: FFIType.pointer,
  },
  // (GListModel*) -> guint number of items
  g_list_model_get_n_items: {
    args: [FFIType.pointer],
    returns: FFIType.u32,
  },
  // (GListModel*, guint position) -> transfer-full gpointer (caller g_object_unref's)
  g_list_model_get_item: {
    args: [FFIType.pointer, FFIType.u32],
    returns: FFIType.pointer,
  },
  // (GBytes*) -> GInputStream* (transfer-full). Takes its own ref on the GBytes,
  // so the caller unrefs its local GBytes after this returns.
  g_memory_input_stream_new_from_bytes: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (stream, count /*gsize*/, io_priority /*G_PRIORITY_DEFAULT=0*/, cancellable /*null*/,
  //  GAsyncReadyCallback, user_data /*null*/) -> void. Never the sync read: the clipboard
  //  stream is fed by the pumped GMainContext, so blocking on it deadlocks (gtk-clipboard.ts).
  g_input_stream_read_bytes_async: {
    args: [
      FFIType.pointer,
      FFIType.u64,
      FFIType.i32,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
    ],
    returns: FFIType.void,
  },
  // (stream, result, error /*null*/) -> transfer-full GBytes* (0 bytes at EOF, NULL on
  // error). Caller g_bytes_unref's the result.
  g_input_stream_read_bytes_finish: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.pointer,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopenLinux<typeof GIO_FFI_SYMBOLS>> | undefined } = {
  ffi: undefined,
};

export const loadGioFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `loadGioFFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
  if (cache.ffi) {
    return cache.ffi;
  }
  const ffi = dlopenLinux(LIBGIO_PATH, GIO_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};

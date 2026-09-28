import { type FFIFunction, FFIType } from 'bun:ffi';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import {
  type EngineResolution,
  engineLibPath,
  prepareEngineForLoad,
  resolveEngine,
} from '../../engine/resolve';
import { dlopen, type NarrowLibrary } from '../dlopen';

const LIBGLIB_PATH = 'libglib-2.0.so.0';

/** The dlopen path for `soname`: the pinned engine's bundled copy if present, else the soname. */
export const linuxLibPath = (
  engine: EngineResolution,
  soname: string,
  exists: (path: string) => boolean = existsSync,
  cwd: string = process.cwd(),
): string => {
  const bundled = engineLibPath(engine, soname);
  if (bundled !== soname && exists(bundled)) {
    return bundled;
  }
  // Bun retries a failed bare-name dlopen as <cwd>/<name>, which would run a planted library.
  if (exists(join(cwd, soname))) {
    throw new Error(
      `refusing to dlopen ${soname}: a file of that name is in the working directory`,
    );
  }
  return soname;
};

/**
 * `dlopen` for every Linux loader. A pinned engine must supply GLib, GTK and the rest of its
 * closure to the whole process: a bare-soname load of any of them first binds the system copy,
 * and the engine's GTK/WebKit then resolve their DT_NEEDED against it (mixed GLib, or two GTKs).
 */
export const dlopenLinux = <Fns extends Record<string, FFIFunction>>(
  soname: string,
  symbols: Fns,
): NarrowLibrary<Fns> => {
  const engine = resolveEngine();
  prepareEngineForLoad(engine, process.env, (text) => process.stderr.write(text));
  return dlopen(linuxLibPath(engine, soname), symbols);
};

export const GLIB_FFI_SYMBOLS = {
  g_main_context_iteration: {
    args: [FFIType.pointer, FFIType.i32],
    returns: FFIType.i32,
  },
  g_main_context_pending: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  g_free: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  // (data, size) -> GBytes* (copies the bytes; refcounted)
  g_bytes_new: {
    args: [FFIType.pointer, FFIType.u64],
    returns: FFIType.pointer,
  },
  g_bytes_unref: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  // (bytes) -> gsize length of the byte buffer.
  g_bytes_get_size: {
    args: [FFIType.pointer],
    returns: FFIType.u64,
  },
  // (bytes, size_out /*null ok*/) -> gconstpointer to the raw bytes (owned by GBytes).
  g_bytes_get_data: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (string) -> GQuark (guint32).
  g_quark_from_string: {
    args: [FFIType.cstring],
    returns: FFIType.u32,
  },
  // (domain:GQuark, code:gint, message) -> GError* (transfer-full; g_error_free).
  g_error_new_literal: {
    args: [FFIType.u32, FFIType.i32, FFIType.cstring],
    returns: FFIType.pointer,
  },
  g_error_free: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  // (value /*GVariant* boolean 'b'*/) -> gboolean. ABORTS if value is not a boolean -
  // guard with g_variant_get_type_string first (a native abort is NOT JS-catchable).
  g_variant_get_boolean: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  // (value /*GVariant* container*/) -> gsize child count. Guards get_child_value, which
  //  ABORTS on an out-of-range index.
  g_variant_n_children: {
    args: [FFIType.pointer],
    returns: FFIType.u64,
  },
  // (value) -> const gchar* type string (BORROWED - do NOT free), e.g. "b" for a boolean.
  g_variant_get_type_string: {
    args: [FFIType.pointer],
    returns: FFIType.cstring,
  },
  // (value /*GVariant* tuple*/, index_ /*gsize*/) -> GVariant* (transfer-full; caller
  //  MUST g_variant_unref) - pulls the i-th child out of a tuple (e.g. the `b` from `(b)`).
  g_variant_get_child_value: {
    args: [FFIType.pointer, FFIType.u64],
    returns: FFIType.pointer,
  },
  // (value) -> void.
  g_variant_unref: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  // (value /*GVariant* 'u'*/) -> guint32. ABORTS on a non-u32 - guard with the type string.
  g_variant_get_uint32: {
    args: [FFIType.pointer],
    returns: FFIType.u32,
  },
  // (string) -> GVariant* 's' (FLOATING).
  g_variant_new_string: {
    args: [FFIType.cstring],
    returns: FFIType.pointer,
  },
  // (value) -> GVariant* 'u' (FLOATING).
  g_variant_new_uint32: {
    args: [FFIType.u32],
    returns: FFIType.pointer,
  },
  // (children /*GVariant**/, n_children /*gsize*/) -> GVariant* tuple (FLOATING; SINKS each
  //  child's floating ref). Explicit builder avoids the fragile varargs g_variant_new.
  g_variant_new_tuple: {
    args: [FFIType.pointer, FFIType.u64],
    returns: FFIType.pointer,
  },
  // (value /*gboolean*/) -> GVariant* 'b' (FLOATING).
  g_variant_new_boolean: {
    args: [FFIType.i32],
    returns: FFIType.pointer,
  },
  // (value) -> GVariant* 'i' (FLOATING).
  g_variant_new_int32: {
    args: [FFIType.i32],
    returns: FFIType.pointer,
  },
  // (object_path) -> GVariant* 'o' (FLOATING).
  g_variant_new_object_path: {
    args: [FFIType.cstring],
    returns: FFIType.pointer,
  },
  // (type_string) -> GVariantType* (transfer-full). Builders BORROW it.
  g_variant_type_new: {
    args: [FFIType.cstring],
    returns: FFIType.pointer,
  },
  // (type:GVariantType*) -> GVariantBuilder* (heap; g_variant_builder_unref).
  g_variant_builder_new: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (builder, type:GVariantType*) -> void.
  g_variant_builder_open: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  g_variant_builder_close: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  // (builder, value) -> void. SINKS a floating child value.
  g_variant_builder_add_value: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  // (builder) -> GVariant* (FLOATING; the built container). Builder must still be unref'd after.
  g_variant_builder_end: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  g_variant_builder_unref: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  // (type, data, size /*gsize*/, trusted /*gboolean*/, notify|null, user_data|null) -> GVariant*
  //  (FLOATING). With notify=NULL the `data` buffer MUST outlive the variant (retain it).
  g_variant_new_from_data: {
    args: [
      FFIType.pointer,
      FFIType.pointer,
      FFIType.u64,
      FFIType.i32,
      FFIType.pointer,
      FFIType.pointer,
    ],
    returns: FFIType.pointer,
  },
  // (GList*) -> void. Frees the LIST CELLS ONLY - each node's data must already
  // have been freed by its owner (e.g. soup_cookie_free), or it leaks.
  g_list_free: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  // (GDateTime*) -> gint64 unix seconds. i64, not i32 - post-2038 dates truncate.
  g_date_time_to_unix: {
    args: [FFIType.pointer],
    returns: FFIType.i64,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopenLinux<typeof GLIB_FFI_SYMBOLS>> | undefined } = {
  ffi: undefined,
};

export const loadGlibFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `loadGlibFFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
  if (cache.ffi) {
    return cache.ffi;
  }
  const ffi = dlopenLinux(LIBGLIB_PATH, GLIB_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};

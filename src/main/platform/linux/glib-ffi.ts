import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * Loads GLib's main-context iteration symbols plus `g_free`.
 *
 * GLib (not GTK directly) owns the main-loop primitives Bunmaska uses to pump the
 * Linux UI cooperatively, mirroring the macOS CoreFoundation pump (D020).
 * `libglib-2.0` is a hard dependency of GTK 4, so it is always present wherever
 * `libgtk-4` is.
 *
 * `g_main_context_iteration(context, may_block)` dispatches at most one set of
 * ready sources; a `NULL` context means the default one. `g_main_context_pending`
 * reports whether any sources are ready, letting us drain to quiescence without
 * ever blocking Bun's thread. `g_free` releases the transfer-full `char*`
 * returned by `jsc_value_to_string` (NULL-safe no-op).
 *
 * `g_bytes_new(data, size)` copies `size` bytes into a refcounted `GBytes*` (so
 * the source buffer need only outlive the call); `g_bytes_unref(bytes)` drops a
 * ref. These back the GDK clipboard write path, where the content provider takes
 * its own ref on the `GBytes` and the caller unrefs the local one.
 *
 * Only callable on Linux — throws {@link UnsupportedPlatformError} otherwise so
 * the module stays safely importable on macOS for unit testing.
 */

const LIBGLIB_PATH = 'libglib-2.0.so.0';

/** The GLib FFI symbol descriptor table. */
export const GLIB_FFI_SYMBOLS = {
  g_main_context_default: {
    args: [],
    returns: FFIType.pointer,
  },
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
  // (string) -> GQuark (a guint32 id). Used to build an error domain for the
  // GError handed to webkit_uri_scheme_request_finish_error.
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
  // (value /*GVariant* boolean 'b'*/) -> gboolean. ABORTS if value is not a boolean —
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
  // (value) -> const gchar* type string (BORROWED — do NOT free), e.g. "b" for a boolean.
  g_variant_get_type_string: {
    args: [FFIType.pointer],
    returns: FFIType.cstring,
  },
  // (value /*GVariant* tuple*/, index_ /*gsize*/) -> GVariant* (transfer-full; caller
  //  MUST g_variant_unref) — pulls the i-th child out of a tuple (e.g. the `b` from `(b)`).
  g_variant_get_child_value: {
    args: [FFIType.pointer, FFIType.u64],
    returns: FFIType.pointer,
  },
  // (value) -> void. Drops a ref on a transfer-full GVariant.
  g_variant_unref: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  // (value /*GVariant* 'u'*/) -> guint32. ABORTS on a non-u32 — guard with the type string.
  g_variant_get_uint32: {
    args: [FFIType.pointer],
    returns: FFIType.u32,
  },
  // (string) -> GVariant* 's' (FLOATING). Builds a D-Bus method arg.
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
  // (value) -> GVariant* 'i' (FLOATING). Width/height for the SNI a(iiay) icon.
  g_variant_new_int32: {
    args: [FFIType.i32],
    returns: FFIType.pointer,
  },
  // (object_path) -> GVariant* 'o' (FLOATING). The SNI Menu property.
  g_variant_new_object_path: {
    args: [FFIType.cstring],
    returns: FFIType.pointer,
  },
  // (type_string) -> GVariantType* (transfer-full; g_variant_type_free). Builders BORROW it.
  g_variant_type_new: {
    args: [FFIType.cstring],
    returns: FFIType.pointer,
  },
  g_variant_type_free: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  // (type:GVariantType*) -> GVariantBuilder* (heap; g_variant_builder_unref).
  g_variant_builder_new: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (builder, type:GVariantType*) -> void. Opens a nested container.
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
  // (value) -> GVariant*. Sinks a floating ref + adds one full ref (so we OWN the value).
  g_variant_ref_sink: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopen<typeof GLIB_FFI_SYMBOLS>> | undefined } = {
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
  const ffi = dlopen(LIBGLIB_PATH, GLIB_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};

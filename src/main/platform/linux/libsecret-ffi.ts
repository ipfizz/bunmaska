import { dlopen, FFIType, type Pointer } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import { cstr } from '../cstr';

/**
 * libsecret symbols behind the Linux keyring backend of `safeStorage`.
 *
 * The simple-password API stores/looks up a single secret under a `SecretSchema`.
 * We build the schema with {@link secret_schema_new} (libsecret owns the struct
 * layout — no blind offset reasoning) carrying ZERO attributes, so the schema
 * identifies one secret and the variadic attribute lists collapse to a trailing
 * `NULL`. We pass `NULL` for every `GError**` out-param (a NULL/0 return already
 * means "absent or failed"), which sidesteps GError ownership + pointer-precision
 * entirely.
 *
 * These calls are SYNCHRONOUS (blocking D-Bus). They are gated off in CI and
 * never run from unit tests (see `libsecret-keyring.ts`). Only callable on Linux.
 */

const LIBSECRET_PATH = 'libsecret-1.so.0';
const SCHEMA_NAME = 'dev.sambar.safeStorage';
/** `SECRET_SCHEMA_NONE` — the secret is tagged with the schema name, so a zero-attribute lookup finds it. */
const SECRET_SCHEMA_NONE = 0;

export const LIBSECRET_FFI_SYMBOLS = {
  // (name, flags, ...attrs terminated by NULL) -> SecretSchema* (transfer-full).
  secret_schema_new: {
    args: [FFIType.cstring, FFIType.i32, FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (schema, collection|null, label, password, cancellable|null, error|null, NULL) -> gboolean
  secret_password_store_sync: {
    args: [
      FFIType.pointer,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
    ],
    returns: FFIType.i32,
  },
  // (schema, cancellable|null, error|null, NULL) -> gchar* (NULL if absent OR error)
  secret_password_lookup_sync: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (password) -> void; frees a transfer-full gchar* from lookup.
  secret_password_free: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
} as const;

const cache: {
  ffi: ReturnType<typeof dlopen<typeof LIBSECRET_FFI_SYMBOLS>> | undefined;
  schema: Pointer | undefined;
} = { ffi: undefined, schema: undefined };

const requireLinux = (): void => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `libsecret is only supported on Linux; current platform is ${platform}`,
    );
  }
};

/** Open `libsecret-1.so.0` and expose the simple-password symbols. */
export const loadLibsecretFFI = () => {
  requireLinux();
  if (cache.ffi) {
    return cache.ffi;
  }
  const ffi = dlopen(LIBSECRET_PATH, LIBSECRET_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};

/** The shared, zero-attribute `SecretSchema*` (built + cached once). */
export const secretSchema = (): Pointer => {
  if (cache.schema !== undefined) {
    return cache.schema;
  }
  const schema = loadLibsecretFFI().symbols.secret_schema_new(
    cstr(SCHEMA_NAME),
    SECRET_SCHEMA_NONE,
    null,
  );
  if (schema === null) {
    throw new Error('safeStorage: secret_schema_new() returned null');
  }
  cache.schema = schema;
  return schema;
};

import { randomBytes } from 'node:crypto';
import { CString, type Pointer } from 'bun:ffi';
import type { KeyringBackend } from '../../api/safe-storage';
import { cstr } from '../cstr';
import { loadLibsecretFFI, secretSchema } from './libsecret-ffi';

/**
 * Linux libsecret backend for `safeStorage`. The 32-byte key is stored as a
 * lowercase-hex STRING (libsecret passwords are NUL-terminated C strings, so raw
 * bytes are unsafe) in the default login keyring under a fixed zero-attribute
 * schema.
 *
 * The real store/lookup is SYNCHRONOUS (blocking D-Bus) and is gated behind
 * `SAMBAR_ENABLE_LINUX_KEYRING` — CI never sets it, so the blocking path is
 * unreachable under xvfb (echoing the GIO-read deadlock lesson). Crucially,
 * `isAvailable()` is CHEAP + NON-BLOCKING: it only checks the gate + that the
 * library dlopens; the one blocking keyring round-trip happens lazily inside
 * `getOrCreateKey()` (called once, behind the API's key cache).
 */

const LABEL = 'Sambar safeStorage key';

/** Whether the live keyring path is enabled. CI leaves this unset → backend reports unavailable. */
const liveKeyringEnabled = (): boolean => process.env['SAMBAR_ENABLE_LINUX_KEYRING'] === '1';

/** Read a transfer-full `gchar*` into a JS string and `secret_password_free` it. */
const takePassword = (password: Pointer): string => {
  const value = new CString(password).toString();
  loadLibsecretFFI().symbols.secret_password_free(password);
  return value;
};

/** Look up the stored hex key. Returns null if absent OR on any error. Never throws. */
const lookupHex = (): string | null => {
  const lib = loadLibsecretFFI();
  let result: Pointer | null;
  try {
    // (schema, cancellable=null, error=null, NULL terminator). A NULL error
    // out-param means a null return already covers "absent or failed".
    result = lib.symbols.secret_password_lookup_sync(secretSchema(), null, null, null);
  } catch {
    return null;
  }
  return result === null ? null : takePassword(result);
};

/** Store the hex key. Returns false on any failure. */
const storeHex = (hex: string): boolean => {
  const lib = loadLibsecretFFI();
  try {
    // (schema, collection=null→default, label, password, cancellable=null, error=null, NULL)
    const ok = lib.symbols.secret_password_store_sync(
      secretSchema(),
      null,
      cstr(LABEL),
      cstr(hex),
      null,
      null,
      null,
    );
    return ok !== 0;
  } catch {
    return false;
  }
};

/** Decode a stored hex value to a 32-byte key, or throw if it is malformed (never overwrite). */
const decodeKey = (hex: string): Buffer => {
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    throw new Error(
      'safeStorage: existing Linux keyring key is malformed; refusing to overwrite it',
    );
  }
  return buf;
};

export const linuxLibsecretBackend: KeyringBackend = {
  // Cheap + non-blocking: the gate must be on AND the library must dlopen. The
  // actual keyring round-trip is deferred to getOrCreateKey().
  isAvailable: () => {
    if (!liveKeyringEnabled()) {
      return false;
    }
    try {
      loadLibsecretFFI();
      return true;
    } catch {
      return false;
    }
  },
  getOrCreateKey: () => {
    const existing = lookupHex();
    if (existing !== null) {
      return decodeKey(existing);
    }
    const fresh = randomBytes(32);
    if (!storeHex(fresh.toString('hex'))) {
      throw new Error('safeStorage: failed to store key in the Linux keyring');
    }
    // Adopt whatever the keyring actually holds (a concurrent writer may have won).
    const winner = lookupHex();
    return winner !== null ? decodeKey(winner) : fresh;
  },
};

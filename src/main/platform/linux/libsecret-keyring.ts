import { randomBytes } from 'node:crypto';
import { CString, type Pointer } from 'bun:ffi';
import type { KeyringBackend } from '../services';
import { cstr } from '../cstr';
import { loadLibsecretFFI, secretSchema } from './libsecret-ffi';

// The key is stored as hex: libsecret passwords are NUL-terminated C strings. Env gate and a
// non-blocking isAvailable per D036.
// The item is keyed by app name (`secret_password_*` label + identity), so two apps that share a name share a key.
// ponytail: the *_sync calls block the JS thread on a keyring unlock prompt; prefetch async at app ready.

const LABEL = 'Bunmaska safeStorage key';

const liveKeyringEnabled = (): boolean => process.env['BUNMASKA_ENABLE_LINUX_KEYRING'] === '1';

const takePassword = (password: Pointer): string => {
  const value = new CString(password).toString();
  loadLibsecretFFI().symbols.secret_password_free(password);
  return value;
};

/** null when absent or on any error. */
const lookupHex = (appId: string): string | null => {
  const lib = loadLibsecretFFI();
  let result: Pointer | null;
  try {
    result = lib.symbols.secret_password_lookup_sync(
      secretSchema(),
      null,
      null,
      cstr('application'),
      cstr(appId),
      null,
    );
  } catch {
    return null;
  }
  return result === null ? null : takePassword(result);
};

const storeHex = (hex: string, appId: string): boolean => {
  const lib = loadLibsecretFFI();
  try {
    const ok = lib.symbols.secret_password_store_sync(
      secretSchema(),
      null,
      cstr(LABEL),
      cstr(hex),
      null,
      null,
      cstr('application'),
      cstr(appId),
      null,
    );
    return ok !== 0;
  } catch {
    return false;
  }
};

/** Throws on a malformed stored key: overwriting it would orphan every blob encrypted under it. */
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
  getOrCreateKey: (appId = 'bunmaska') => {
    const identity = appId.length > 0 ? appId : 'bunmaska';
    const existing = lookupHex(identity);
    if (existing !== null) {
      return decodeKey(existing);
    }
    const fresh = randomBytes(32);
    if (!storeHex(fresh.toString('hex'), identity)) {
      throw new Error('safeStorage: failed to store key in the Linux keyring');
    }
    const winner = lookupHex(identity);
    return winner !== null ? decodeKey(winner) : fresh;
  },
};

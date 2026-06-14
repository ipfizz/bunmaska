import { randomBytes } from 'node:crypto';
import { ptr, toArrayBuffer } from 'bun:ffi';
import type { KeyringBackend } from '../../api/safe-storage';
import { nsString } from './cocoa-foundation';
import { msgSendPtrI64, msgSendPtrPtr } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { type Handle, ptrIn } from './objc';
import { loadSecurityFFI, secConstants } from './security-ffi';

/**
 * macOS Keychain backend for `safeStorage`. The 32-byte key is a
 * `kSecClassGenericPassword` item under a fixed service+account, created on first
 * use. The query is an `NSMutableDictionary` (toll-free bridged to
 * `CFDictionaryRef`), avoiding `CFDictionaryCreate` and its callback-struct
 * globals; the keys are the REAL exported `kSec*` constants (SecItem compares
 * keys by pointer identity). The item is created with
 * `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` so the key is device-bound and
 * never syncs to iCloud Keychain.
 *
 * The service/account are injectable so the integration test exercises a PROBE
 * item rather than the production key.
 */

const ERR_SEC_SUCCESS = 0;
const ERR_SEC_ITEM_NOT_FOUND = -25300;
const ERR_SEC_DUPLICATE_ITEM = -25299;

/** `[[NSData alloc] initWithBytes:length:]` from a Buffer (copies the bytes). */
const nsDataFromBytes = (bytes: Buffer): Handle => {
  const rt = cocoa();
  const alloc = rt.msgSend(rt.classes.get('NSData'), rt.selectors.get('alloc'));
  const dataPtr = bytes.length === 0 ? 0n : BigInt(ptr(bytes));
  return msgSendPtrI64(
    alloc,
    rt.selectors.get('initWithBytes:length:'),
    dataPtr,
    BigInt(bytes.length),
  );
};

/** `[dict setObject:value forKey:key]`. */
const dictSet = (dict: Handle, value: Handle, key: Handle): void => {
  const rt = cocoa();
  msgSendPtrPtr(dict, rt.selectors.get('setObject:forKey:'), value, key);
};

/** Build a macOS Keychain backend bound to a specific service + account. */
export const makeMacosKeychainBackend = (service: string, account: string): KeyringBackend => {
  /** The {class, service, account} identity dictionary shared by every op. */
  const baseQuery = (): Handle => {
    const k = secConstants();
    const rt = cocoa();
    const dict = rt.msgSend(rt.classes.get('NSMutableDictionary'), rt.selectors.get('dictionary'));
    dictSet(dict, k.kSecClassGenericPassword, k.kSecClass);
    dictSet(dict, nsString(service), k.kSecAttrService);
    dictSet(dict, nsString(account), k.kSecAttrAccount);
    return dict;
  };

  /** Read the stored key, or null if the item does not exist. Throws on real errors. */
  const lookupKey = (): Buffer | null => {
    const sec = loadSecurityFFI();
    const k = secConstants();
    const rt = cocoa();
    const query = baseQuery();
    dictSet(query, k.kCFBooleanTrue, k.kSecReturnData);
    dictSet(query, k.kSecMatchLimitOne, k.kSecMatchLimit);
    const out = new BigUint64Array(1);
    const status = sec.symbols.SecItemCopyMatching(query, ptr(out));
    if (status === ERR_SEC_ITEM_NOT_FOUND) {
      return null;
    }
    if (status !== ERR_SEC_SUCCESS) {
      throw new Error(`safeStorage: SecItemCopyMatching failed (OSStatus ${status})`);
    }
    const cfData = out[0] ?? 0n;
    const len = Number(rt.msgSend(cfData, rt.selectors.get('length')));
    const bytesPtr = rt.msgSend(cfData, rt.selectors.get('bytes'));
    const copy =
      len > 0 && bytesPtr !== 0n
        ? Buffer.from(toArrayBuffer(ptrIn(bytesPtr), 0, len).slice(0))
        : Buffer.alloc(0);
    sec.symbols.CFRelease(cfData); // Copy ownership rule: the caller releases.
    return copy;
  };

  /** Persist a freshly generated 32-byte key. Returns false if we lost an add race. */
  const addKey = (key: Buffer): boolean => {
    const sec = loadSecurityFFI();
    const k = secConstants();
    const query = baseQuery();
    dictSet(query, nsDataFromBytes(key), k.kSecValueData);
    // Device-bound, non-syncing accessibility.
    dictSet(query, k.kSecAttrAccessibleWhenUnlockedThisDeviceOnly, k.kSecAttrAccessible);
    const status = sec.symbols.SecItemAdd(query, null);
    if (status === ERR_SEC_SUCCESS) {
      return true;
    }
    if (status === ERR_SEC_DUPLICATE_ITEM) {
      return false; // another caller added it first; re-read.
    }
    throw new Error(`safeStorage: SecItemAdd failed (OSStatus ${status})`);
  };

  return {
    // A non-throwing read probe: the login Keychain is reachable iff a lookup does
    // not error (a null result — no item yet — still means "available").
    isAvailable: () => {
      try {
        lookupKey();
        return true;
      } catch {
        return false;
      }
    },
    getOrCreateKey: () => {
      const existing = lookupKey();
      if (existing !== null) {
        return existing;
      }
      const fresh = randomBytes(32);
      if (addKey(fresh)) {
        return fresh;
      }
      // Lost the add race — adopt the winner's key.
      const winner = lookupKey();
      if (winner === null) {
        throw new Error('safeStorage: key vanished after a duplicate-item race');
      }
      return winner;
    },
  };
};

/** Delete the Keychain item for `service`/`account` (test cleanup). Best-effort. */
export const deleteMacosKeychainItem = (service: string, account: string): void => {
  const sec = loadSecurityFFI();
  const k = secConstants();
  const rt = cocoa();
  const query = rt.msgSend(rt.classes.get('NSMutableDictionary'), rt.selectors.get('dictionary'));
  dictSet(query, k.kSecClassGenericPassword, k.kSecClass);
  dictSet(query, nsString(service), k.kSecAttrService);
  dictSet(query, nsString(account), k.kSecAttrAccount);
  sec.symbols.SecItemDelete(query);
};

/** The production macOS Keychain backend. */
export const macosKeychainBackend = makeMacosKeychainBackend(
  'dev.bunmaska.safeStorage',
  'master-key',
);

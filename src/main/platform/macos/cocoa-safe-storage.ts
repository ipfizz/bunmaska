import { randomBytes } from 'node:crypto';
import { ptr } from 'bun:ffi';
import type { KeyringBackend } from '../services';
import { nsString } from './cocoa-foundation';
import { msgSendPtrPtr } from './cocoa-msgsend-variants';
import { nsDataFromBytes, nsDataToBytes } from './cocoa-native-image';
import { cocoa } from './cocoa-runtime';
import type { Handle } from './objc';
import { loadSecurityFFI, secConstants } from './security-ffi';

// SecItem matches dictionary keys by pointer: always use the exported kSec* constants (security-ffi.ts).

const ERR_SEC_SUCCESS = 0;
const ERR_SEC_ITEM_NOT_FOUND = -25300;
const ERR_SEC_DUPLICATE_ITEM = -25299;

const dictSet = (dict: Handle, value: Handle, key: Handle): void => {
  const rt = cocoa();
  msgSendPtrPtr(dict, rt.selectors.get('setObject:forKey:'), value, key);
};

/** The {class, service, account} identity dictionary every Keychain op starts from. */
const identityQuery = (service: string, account: string): Handle => {
  const k = secConstants();
  const rt = cocoa();
  const dict = rt.msgSend(rt.classes.get('NSMutableDictionary'), rt.selectors.get('dictionary'));
  dictSet(dict, k.kSecClassGenericPassword, k.kSecClass);
  dictSet(dict, nsString(service), k.kSecAttrService);
  dictSet(dict, nsString(account), k.kSecAttrAccount);
  return dict;
};

/** Build a macOS Keychain backend bound to a specific service + account. */
export const makeMacosKeychainBackend = (service: string, account: string): KeyringBackend => {
  const baseQuery = (): Handle => identityQuery(service, account);

  /** Read the stored key, or null if the item does not exist. Throws on real errors. */
  const lookupKey = (): Buffer | null => {
    const sec = loadSecurityFFI();
    const k = secConstants();
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
    const copy = Buffer.from(nsDataToBytes(cfData));
    sec.symbols.CFRelease(cfData); // Copy ownership rule: the caller releases.
    return copy;
  };

  /** Persist a freshly generated 32-byte key. Returns false if we lost an add race. */
  const addKey = (key: Buffer): boolean => {
    const sec = loadSecurityFFI();
    const k = secConstants();
    const query = baseQuery();
    const data = nsDataFromBytes(key);
    dictSet(query, data, k.kSecValueData);
    cocoa().msgSend(data, cocoa().selectors.get('release')); // the dictionary retains it
    // The file-based login keychain ignores this (it stores no pdmn), but it never syncs to iCloud.
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
    // Never request the secret here: reading data can raise a blocking Keychain ACL prompt.
    isAvailable: () => {
      try {
        const status = loadSecurityFFI().symbols.SecItemCopyMatching(baseQuery(), null);
        return status === ERR_SEC_SUCCESS || status === ERR_SEC_ITEM_NOT_FOUND;
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
      // Lost the add race: adopt the winner's key.
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
  loadSecurityFFI().symbols.SecItemDelete(identityQuery(service, account));
};

// ponytail: one Keychain item for every Bunmaska app on the machine; key it by app name via api/safe-storage.ts.
export const macosKeychainBackend = makeMacosKeychainBackend(
  'dev.bunmaska.safeStorage',
  'master-key',
);

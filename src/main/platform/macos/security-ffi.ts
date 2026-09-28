import { FFIType, read } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { dataSymbolAddress, macOSLibraryAccessor } from './objc';

/**
 * Security.framework + CoreFoundation symbols behind the macOS Keychain backend
 * of `safeStorage`.
 *
 * `SecItemAdd`/`SecItemCopyMatching`/`SecItemDelete` take a `CFDictionaryRef`
 * query; we pass an `NSMutableDictionary` (toll-free bridged) as a `u64` handle
 * to match the codebase's ObjC-handle convention (D029). The dictionary KEYS must
 * be the REAL exported `kSec*` `CFStringRef` constants — SecItem compares keys by
 * POINTER identity, so value-equal CFStrings are rejected (errSecParam, -50).
 *
 * Reading those constants needs `dlsym` + a pointer-precise memory read: Bun's
 * `dlopen` only exposes FUNCTION symbols (a declared symbol is CALLED), so a DATA
 * global is resolved via `dlsym(handle, name)` then `read.u64(addr, 0)` (NOT
 * `BigInt(read.ptr(...))`, which round-trips through a lossy JS number — D029).
 */

const SECURITY_PATH = '/System/Library/Frameworks/Security.framework/Security';
const CORE_FOUNDATION_PATH = '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation';

export const loadSecurityFFI = macOSLibraryAccessor('Security.framework safeStorage', () =>
  dlopen(SECURITY_PATH, {
    // SecItem args: the bridged NSMutableDictionary (u64 handle) + a CFTypeRef out-ptr.
    SecItemAdd: { args: [FFIType.u64, FFIType.pointer], returns: FFIType.i32 },
    SecItemCopyMatching: { args: [FFIType.u64, FFIType.pointer], returns: FFIType.i32 },
    SecItemDelete: { args: [FFIType.u64], returns: FFIType.i32 },
    CFRelease: { args: [FFIType.u64], returns: FFIType.void },
  }),
);

/** The `kSec*` / `kCF*` constants the Keychain query dictionary needs (as `CFTypeRef` handles). */
export type SecConstants = {
  kSecClass: bigint;
  kSecClassGenericPassword: bigint;
  kSecAttrService: bigint;
  kSecAttrAccount: bigint;
  kSecValueData: bigint;
  kSecReturnData: bigint;
  kSecMatchLimit: bigint;
  kSecMatchLimitOne: bigint;
  kSecAttrAccessible: bigint;
  kSecAttrAccessibleWhenUnlockedThisDeviceOnly: bigint;
  kCFBooleanTrue: bigint;
};

let cached: SecConstants | undefined;

export const secConstants = (): SecConstants => {
  if (cached !== undefined) {
    return cached;
  }
  const s = (name: string): bigint => read.u64(dataSymbolAddress(SECURITY_PATH, name), 0);
  cached = {
    kSecClass: s('kSecClass'),
    kSecClassGenericPassword: s('kSecClassGenericPassword'),
    kSecAttrService: s('kSecAttrService'),
    kSecAttrAccount: s('kSecAttrAccount'),
    kSecValueData: s('kSecValueData'),
    kSecReturnData: s('kSecReturnData'),
    kSecMatchLimit: s('kSecMatchLimit'),
    kSecMatchLimitOne: s('kSecMatchLimitOne'),
    kSecAttrAccessible: s('kSecAttrAccessible'),
    kSecAttrAccessibleWhenUnlockedThisDeviceOnly: s('kSecAttrAccessibleWhenUnlockedThisDeviceOnly'),
    kCFBooleanTrue: read.u64(dataSymbolAddress(CORE_FOUNDATION_PATH, 'kCFBooleanTrue'), 0),
  };
  return cached;
};

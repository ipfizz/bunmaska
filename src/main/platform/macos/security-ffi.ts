import { FFIType, read } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { dataSymbolAddress, macOSLibraryAccessor } from './objc';

/**
 * Keychain symbols behind macOS `safeStorage`. The query dictionary's KEYS must be the
 * exported `kSec*` constants: SecItem compares keys by POINTER identity, so a value-equal
 * CFString fails with errSecParam (-50). Read each constant with `read.u64`, never
 * `BigInt(read.ptr())`, which goes through a lossy JS number (D029).
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

/** The `kSec*` / `kCF*` constants the Keychain query needs, as `CFTypeRef` handles. */
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

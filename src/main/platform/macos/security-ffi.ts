import { dlopen, FFIType, read } from 'bun:ffi';
import { cstr } from '../cstr';
import { macOSLibraryAccessor } from './objc';

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

const LIBSYSTEM_PATH = '/usr/lib/libSystem.B.dylib';
const SECURITY_PATH = '/System/Library/Frameworks/Security.framework/Security';
const CORE_FOUNDATION_PATH = '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation';
const RTLD_NOW = 2;

const loadDl = macOSLibraryAccessor('libSystem dlsym', () =>
  dlopen(LIBSYSTEM_PATH, {
    dlopen: { args: [FFIType.cstring, FFIType.i32], returns: FFIType.pointer },
    dlsym: { args: [FFIType.pointer, FFIType.cstring], returns: FFIType.pointer },
  }),
);

export const loadSecurityFFI = macOSLibraryAccessor('Security.framework safeStorage', () =>
  dlopen(SECURITY_PATH, {
    // SecItem args: the bridged NSMutableDictionary (u64 handle) + a CFTypeRef out-ptr.
    SecItemAdd: { args: [FFIType.u64, FFIType.pointer], returns: FFIType.i32 },
    SecItemCopyMatching: { args: [FFIType.u64, FFIType.pointer], returns: FFIType.i32 },
    SecItemDelete: { args: [FFIType.u64], returns: FFIType.i32 },
    CFRelease: { args: [FFIType.u64], returns: FFIType.void },
  }),
);

/** Resolve a data symbol (a `CFTypeRef` global) to its value, pointer-precisely. */
const dataSymbol = (handle: number, name: string): bigint => {
  const dl = loadDl();
  const addr = dl.symbols.dlsym(handle as never, cstr(name));
  if (addr === null) {
    throw new Error(`safeStorage: dlsym('${name}') returned null`);
  }
  return read.u64(addr, 0);
};

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
  const dl = loadDl();
  const secH = dl.symbols.dlopen(cstr(SECURITY_PATH), RTLD_NOW) as unknown as number;
  const cfH = dl.symbols.dlopen(cstr(CORE_FOUNDATION_PATH), RTLD_NOW) as unknown as number;
  const s = (n: string): bigint => dataSymbol(secH, n);
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
    kCFBooleanTrue: dataSymbol(cfH, 'kCFBooleanTrue'),
  };
  return cached;
};

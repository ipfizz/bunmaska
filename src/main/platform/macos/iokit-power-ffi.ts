import { FFIType, type Pointer, ptr } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { macOSLibraryAccessor } from './objc';

const IOKIT_PATH = '/System/Library/Frameworks/IOKit.framework/IOKit';
const CORE_FOUNDATION_PATH = '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation';

const IOKIT_SYMBOLS = {
  IOPSCopyPowerSourcesInfo: { args: [], returns: FFIType.pointer },
  IOPSGetProvidingPowerSourceType: { args: [FFIType.pointer], returns: FFIType.pointer },
} as const;

const CF_SYMBOLS = {
  CFRelease: { args: [FFIType.pointer], returns: FFIType.void },
  CFStringGetCString: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.i64, FFIType.u32],
    returns: FFIType.u8,
  },
} as const;

const kCFStringEncodingUTF8 = 0x08000100;

export const loadIOKitPowerFFI = macOSLibraryAccessor('IOKit power', () =>
  dlopen(IOKIT_PATH, IOKIT_SYMBOLS),
);

const loadCoreFoundation = macOSLibraryAccessor('CoreFoundation power', () =>
  dlopen(CORE_FOUNDATION_PATH, CF_SYMBOLS),
);

const cfStringToJs = (ref: Pointer | null): string => {
  if (ref === null) {
    return '';
  }
  const buf = new Uint8Array(64);
  if (
    loadCoreFoundation().symbols.CFStringGetCString(ref, ptr(buf), 64n, kCFStringEncodingUTF8) === 0
  ) {
    return '';
  }
  const end = buf.indexOf(0);
  return Buffer.from(buf.subarray(0, end === -1 ? buf.length : end)).toString('utf8');
};

/** True when IOKit says the providing source is battery power. */
export const macosIsOnBatteryPower = (): boolean => {
  const iokit = loadIOKitPowerFFI();
  const snapshot = iokit.symbols.IOPSCopyPowerSourcesInfo();
  if (snapshot === null) {
    return false;
  }
  try {
    const type = iokit.symbols.IOPSGetProvidingPowerSourceType(snapshot);
    return cfStringToJs(type) === 'Battery Power';
  } finally {
    loadCoreFoundation().symbols.CFRelease(snapshot);
  }
};

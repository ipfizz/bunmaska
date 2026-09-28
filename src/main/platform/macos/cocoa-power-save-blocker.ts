import { FFIType, ptr } from 'bun:ffi';
import { dlopen } from '../dlopen';
import type {
  NativeBlocker,
  PowerSaveBlockerBackend,
  PowerSaveBlockerType,
} from '../../api/power-save-blocker';
import { nsString } from './cocoa-foundation';
import { macOSLibraryAccessor } from './objc';

// IOPMAssertion calls are synchronous Mach round-trips to powerd; no run loop needed (D038).

const IOKIT_PATH = '/System/Library/Frameworks/IOKit.framework/IOKit';

const K_IOPM_ASSERTION_LEVEL_ON = 255;
const K_IO_RETURN_SUCCESS = 0;

const ASSERTION_TYPE: Record<PowerSaveBlockerType, string> = {
  'prevent-app-suspension': 'PreventUserIdleSystemSleep',
  'prevent-display-sleep': 'PreventUserIdleDisplaySleep',
};

/** Human-readable assertion name shown by `pmset -g assertions`. */
const ASSERTION_NAME = 'Bunmaska powerSaveBlocker';

const IOKIT_SYMBOLS = {
  // (assertionType:CFStringRef[u64], level:IOPMAssertionLevel[u32], name:CFStringRef[u64],
  //  outID:IOPMAssertionID*[ptr]) -> IOReturn[i32].
  IOPMAssertionCreateWithName: {
    args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.pointer],
    returns: FFIType.i32,
  },
  // (assertionID:IOPMAssertionID[u32]) -> IOReturn[i32].
  IOPMAssertionRelease: {
    args: [FFIType.u32],
    returns: FFIType.i32,
  },
} as const;

const loadIOKitFFI = macOSLibraryAccessor('IOKit powerSaveBlocker', () =>
  dlopen(IOKIT_PATH, IOKIT_SYMBOLS),
);

/** The new assertion's `IOPMAssertionID`, or null on failure. */
const acquire = (type: PowerSaveBlockerType): NativeBlocker | null => {
  const iokit = loadIOKitFFI();
  const outId = new Uint32Array(1);
  const status = iokit.symbols.IOPMAssertionCreateWithName(
    nsString(ASSERTION_TYPE[type]), // toll-free CFStringRef
    K_IOPM_ASSERTION_LEVEL_ON,
    nsString(ASSERTION_NAME),
    ptr(outId),
  );
  if (status !== K_IO_RETURN_SUCCESS) {
    return null;
  }
  return outId[0] ?? null; // the IOPMAssertionID (uint32; a success is never 0)
};

/** Release the assertion. Best-effort; a bad id just returns a non-zero IOReturn. */
const release = (handle: NativeBlocker): void => {
  loadIOKitFFI().symbols.IOPMAssertionRelease(handle as number);
};

export const cocoaPowerSaveBlockerBackend: PowerSaveBlockerBackend = { acquire, release };

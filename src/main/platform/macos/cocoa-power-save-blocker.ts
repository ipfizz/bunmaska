import { dlopen, FFIType, ptr } from 'bun:ffi';
import type {
  NativeBlocker,
  PowerSaveBlockerBackend,
  PowerSaveBlockerType,
} from '../../api/power-save-blocker';
import { nsString } from './cocoa-foundation';
import { macOSLibraryAccessor } from './objc';

/**
 * macOS power-save blocker via IOKit power-management assertions.
 *
 * `IOPMAssertionCreateWithName(assertionType, level, name, &id)` creates a named assertion
 * held by `powerd`; `IOPMAssertionRelease(id)` drops it. Both are SYNCHRONOUS C calls (a
 * Mach round-trip to powerd) that need NO CFRunLoop and no window, so they are safe on
 * Sambar's pumped main thread with nothing running.
 *
 * Type → assertion (verified against IOKit's IOPMLib.h):
 *  - 'prevent-app-suspension' → kIOPMAssertPreventUserIdleSystemSleep  ("PreventUserIdleSystemSleep")
 *  - 'prevent-display-sleep'  → kIOPMAssertPreventUserIdleDisplaySleep ("PreventUserIdleDisplaySleep")
 * (display-sleep prevention also keeps the system awake, matching Electron's precedence.)
 *
 * `IOPMAssertionID`/`IOPMAssertionLevel` are `uint32_t`; `kIOPMAssertionLevelOn = 255`;
 * success is `kIOReturnSuccess = 0`. The assertion type/name are `CFStringRef`; an NSString
 * is toll-free bridged to CFStringRef, so {@link nsString} yields one directly (carried as
 * a u64 handle, the codebase's CF/ObjC-handle convention). The out-param `IOPMAssertionID*`
 * is a one-element `Uint32Array`.
 */

const IOKIT_PATH = '/System/Library/Frameworks/IOKit.framework/IOKit';

/** kIOPMAssertionLevelOn — assertion active (IOPMLib.h: 255). */
const K_IOPM_ASSERTION_LEVEL_ON = 255;
/** kIOReturnSuccess. */
const K_IO_RETURN_SUCCESS = 0;

const ASSERTION_TYPE: Record<PowerSaveBlockerType, string> = {
  'prevent-app-suspension': 'PreventUserIdleSystemSleep',
  'prevent-display-sleep': 'PreventUserIdleDisplaySleep',
};

/** Human-readable assertion name shown by `pmset -g assertions`. */
const ASSERTION_NAME = 'Sambar powerSaveBlocker';

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

/** Create a power assertion and return its `IOPMAssertionID`, or null on failure. */
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

/** The macOS power-save-blocker backend (IOKit assertions). */
export const cocoaPowerSaveBlockerBackend: PowerSaveBlockerBackend = { acquire, release };

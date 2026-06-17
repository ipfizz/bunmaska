import { dlopen, FFIType } from 'bun:ffi';
import { macOSLibraryAccessor } from './objc';

/**
 * Carbon framework FFI for system-wide hot keys — the macOS half of
 * `globalShortcut`.
 *
 * Carbon's `RegisterEventHotKey` is the one un-bundled-friendly way to claim a
 * global hot key on macOS: it works from a plain `bun main.ts` process (no
 * Accessibility permission, no app bundle), and the fired events flow through
 * the application's Carbon event target — which is serviced by the same main
 * run loop Bunmaska already pumps (`CFRunLoopRunInMode`, D020). So a registered
 * hot key dispatches through the cooperative pump with no extra wiring.
 *
 * ── EventHotKeyID struct-by-value (load-bearing, verified on this arm64 host) ──
 * `RegisterEventHotKey` takes `EventHotKeyID` (`{ OSType signature; UInt32 id }`,
 * 8 bytes) BY VALUE. `bun:ffi` has NO struct-by-value support. WORKAROUND: on
 * arm64 an 8-byte struct passed by value goes in a single 64-bit register, so we
 * declare that argument as `u64` and pack it as
 * `BigInt(signature) | (BigInt(id) << 32n)` (signature in the low 32 bits, id in
 * the high 32 — matching the struct's field order on a little-endian host).
 * Measured: `RegisterEventHotKey` returns `noErr` and yields a valid
 * `EventHotKeyRef`, and the handler reads the same id back from the event's
 * `kEventParamHotKeyID` parameter. The workaround WORKS.
 *
 * `EventTypeSpec` (the type list for `InstallEventHandler`) is an array of
 * `{ UInt32 eventClass; UInt32 eventKind }` structs passed BY REFERENCE — that is
 * fine: we build a `Uint32Array` and pass its pointer.
 */

const CARBON_PATH = '/System/Library/Frameworks/Carbon.framework/Carbon';

const CARBON_SYMBOLS = {
  // (UInt32 keyCode, UInt32 modifiers, EventHotKeyID id BY VALUE as packed u64,
  //  EventTargetRef target, OptionBits options, EventHotKeyRef *outRef) -> OSStatus
  RegisterEventHotKey: {
    args: [FFIType.u32, FFIType.u32, FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr],
    returns: FFIType.i32,
  },
  // (EventHotKeyRef) -> OSStatus
  UnregisterEventHotKey: {
    args: [FFIType.ptr],
    returns: FFIType.i32,
  },
  // () -> EventTargetRef
  GetApplicationEventTarget: {
    args: [],
    returns: FFIType.ptr,
  },
  // (EventTargetRef, EventHandlerUPP, ItemCount numTypes, const EventTypeSpec *typeList,
  //  void *userData, EventHandlerRef *outRef) -> OSStatus
  InstallEventHandler: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  // (EventRef, OSType name, OSType desiredType, OSType *actualType, ByteCount bufferSize,
  //  ByteCount *actualSize, void *outData) -> OSStatus
  GetEventParameter: {
    args: [
      FFIType.ptr,
      FFIType.u32,
      FFIType.u32,
      FFIType.ptr,
      FFIType.u32,
      FFIType.ptr,
      FFIType.ptr,
    ],
    returns: FFIType.i32,
  },
} as const;

/**
 * Open `Carbon.framework` and return the hot-key/event symbol table. Memoised;
 * throws {@link UnsupportedPlatformError} on any non-macOS host (via the
 * accessor) so the module stays importable everywhere.
 */
export const loadCarbonFFI = macOSLibraryAccessor('Carbon global shortcut', () =>
  dlopen(CARBON_PATH, CARBON_SYMBOLS),
);

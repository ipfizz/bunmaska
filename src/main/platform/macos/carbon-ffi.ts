import { FFIType } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { macOSLibraryAccessor } from './objc';

/**
 * Carbon hot keys behind macOS `globalShortcut`: unlike an NSEvent monitor they need
 * no Accessibility permission or app bundle, and they fire through the pump (D020).
 *
 * `RegisterEventHotKey` takes `EventHotKeyID { OSType signature; UInt32 id }` BY VALUE,
 * which bun:ffi cannot declare. An 8-byte all-integer struct travels in one 64-bit
 * register on both ABIs, so declare it `u64` and pack `BigInt(signature) |
 * (BigInt(id) << 32n)`: signature in the low half, as the little-endian layout puts it.
 * `EventTypeSpec` lists go BY REFERENCE, as a `Uint32Array` pointer.
 */

const CARBON_PATH = '/System/Library/Frameworks/Carbon.framework/Carbon';

export const CARBON_FFI_SYMBOLS = {
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
    args: [FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.ptr],
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
      FFIType.u64,
      FFIType.ptr,
      FFIType.ptr,
    ],
    returns: FFIType.i32,
  },
} as const;

export const loadCarbonFFI = macOSLibraryAccessor('Carbon global shortcut', () =>
  dlopen(CARBON_PATH, CARBON_FFI_SYMBOLS),
);

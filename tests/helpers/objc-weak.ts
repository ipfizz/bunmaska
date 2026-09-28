import { dlopen, FFIType, ptr } from 'bun:ffi';
import { LIBOBJC_PATH } from '../../src/main/platform/macos/objc';

let lib: ReturnType<typeof open> | undefined;
const open = () =>
  dlopen(LIBOBJC_PATH, {
    objc_storeWeak: { args: [FFIType.pointer, FFIType.u64], returns: FFIType.u64 },
    objc_loadWeakRetained: { args: [FFIType.pointer], returns: FFIType.u64 },
  });

/** A zeroing weak reference to an ObjC object: the getter reads 0n once it is deallocated. macOS only. */
export const objcWeakRef = (object: bigint): (() => bigint) => {
  lib ??= open();
  const { symbols } = lib;
  const slot = new BigUint64Array(1);
  symbols.objc_storeWeak(ptr(slot), object);
  return () => symbols.objc_loadWeakRetained(ptr(slot));
};

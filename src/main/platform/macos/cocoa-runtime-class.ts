import { BunmaskaError } from '../../../common/errors';
import { FFIType, JSCallback } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { cstr } from '../cstr';
import { cocoa } from './cocoa-runtime';
import { callFromNative, type Handle, LIBOBJC_PATH, macOSLibraryAccessor } from './objc';

/**
 * Define Objective-C classes at runtime with JS-backed methods:
 * `objc_allocateClassPair` → `class_addMethod` with a `JSCallback` as the IMP →
 * `objc_registerClassPair` (D026).
 *
 * Every Objective-C method's first two args are the implicit `self` (id) and
 * `_cmd` (SEL); declared args follow. All are modelled as `u64` handles (D029).
 */

/**
 * A JS-backed method to attach to a runtime class.
 *
 * `returns` defaults to `'void'`. A `'bool'` method's `impl` must return `0`/`1`
 * (NO/YES); a throwing one answers YES, as in Electron a throwing listener cannot
 * veto. A throwing `'object'` method answers nil. See {@link callFromNative}.
 */
export type ObjcMethodSpec = {
  /** The selector name, e.g. `userContentController:didReceiveScriptMessage:`. */
  readonly selector: string;
  /** The ObjC type encoding, e.g. `v@:@` (void; self, _cmd, one object arg). */
  readonly typeEncoding: string;
  /** The declared (post-`self`/`_cmd`) argument kinds; currently all objects. */
  readonly args: ReadonlyArray<'object'>;
  /** Return kind; defaults to `'void'`. */
  readonly returns?: 'void' | 'bool' | 'object';
  /**
   * The JS implementation. Receives `(self, _cmd, ...args)` as bigint handles.
   * A `returns: 'bool'` method's impl must produce `0`/`1`; a `returns: 'object'`
   * method's impl must produce a `Handle` (`0n` = nil). The build wrapper reads
   * that runtime value (a `() => number`/`() => Handle` is assignable here too).
   */
  readonly impl: (self: Handle, cmd: Handle, ...args: Handle[]) => void;
};

const getRuntime = macOSLibraryAccessor('objc runtime class', () =>
  dlopen(LIBOBJC_PATH, {
    objc_allocateClassPair: {
      args: [FFIType.u64, FFIType.cstring, FFIType.u64],
      returns: FFIType.u64,
    },
    objc_registerClassPair: {
      args: [FFIType.u64],
      returns: FFIType.void,
    },
    class_addMethod: {
      args: [FFIType.u64, FFIType.u64, FFIType.u64, FFIType.cstring],
      returns: FFIType.u8,
    },
  }),
);

// JSCallbacks must outlive the ObjC class that points at them; the runtime keeps
// classes for the process lifetime, so we retain their callbacks for as long.
const retainedCallbacks: JSCallback[] = [];

const buildCallback = (method: ObjcMethodSpec): JSCallback => {
  const args = [FFIType.u64, FFIType.u64, ...method.args.map(() => FFIType.u64)];
  const impl = method.impl as (...handles: Handle[]) => unknown;
  const call = (raw: ReadonlyArray<number | bigint>): unknown =>
    impl(...raw.map((value) => BigInt(value)));
  if (method.returns === 'bool') {
    return new JSCallback(
      (...raw: number[]): number => callFromNative(1, () => (call(raw) === 1 ? 1 : 0)),
      { args, returns: FFIType.u8 },
    );
  }
  if (method.returns === 'object') {
    return new JSCallback(
      (...raw: number[]): bigint =>
        callFromNative(0n, () => {
          const result = call(raw);
          return typeof result === 'bigint' ? result : 0n;
        }),
      { args, returns: FFIType.u64 },
    );
  }
  return new JSCallback(
    (...raw: number[]) => {
      callFromNative(undefined, () => {
        call(raw);
      });
    },
    { args, returns: FFIType.void },
  );
};

/**
 * Allocate, populate, and register an Objective-C class. Returns the class
 * handle. Throws {@link UnsupportedPlatformError} off macOS (via the accessor).
 */
export const defineObjcClass = (
  name: string,
  superclassName: string,
  methods: ReadonlyArray<ObjcMethodSpec>,
): Handle => {
  const runtime = getRuntime();
  const rt = cocoa();
  const superclass = rt.classes.get(superclassName);
  const cls = runtime.symbols.objc_allocateClassPair(superclass, cstr(name), 0n);
  // objc_allocateClassPair returns nil for a duplicate name; class_addMethod on
  // nil then corrupts silently instead of failing here.
  if (cls === 0n) {
    throw new BunmaskaError(
      `defineObjcClass: objc_allocateClassPair returned nil for ${JSON.stringify(name)} — the class name is already registered in this process`,
    );
  }

  for (const method of methods) {
    const callback = buildCallback(method);
    retainedCallbacks.push(callback);
    const imp = callback.ptr === null ? 0n : BigInt(callback.ptr);
    runtime.symbols.class_addMethod(
      cls,
      rt.selectors.get(method.selector),
      imp,
      cstr(method.typeEncoding),
    );
  }

  runtime.symbols.objc_registerClassPair(cls);
  return cls;
};

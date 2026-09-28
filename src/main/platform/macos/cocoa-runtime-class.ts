import { BunmaskaError } from '../../../common/errors';
import { FFIType, JSCallback } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { cstr } from '../cstr';
import { cocoa } from './cocoa-runtime';
import { callFromNative, type Handle, LIBOBJC_PATH, macOSLibraryAccessor } from './objc';

/**
 * A JS-backed method for a runtime class. A throwing impl answers YES for `'bool'`
 * (as in Electron, a throwing listener cannot veto) and nil for `'object'`.
 */
export type ObjcMethodSpec = {
  readonly selector: string;
  readonly typeEncoding: string;
  /** Kinds after `self`/`_cmd`; a BOOL is defined only in its low byte, so never read it as an object. */
  readonly args: ReadonlyArray<'object' | 'bool'>;
  readonly returns?: 'void' | 'bool' | 'object';
  /** Gets `(self, _cmd, ...args)`; returns 0/1 for `'bool'`, a Handle (0n = nil) for `'object'`. */
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

// Never close these: a registered class and its IMPs live for the whole process.
const retainedCallbacks: JSCallback[] = [];

const buildCallback = (method: ObjcMethodSpec): JSCallback => {
  const args = [
    FFIType.u64,
    FFIType.u64,
    ...method.args.map((kind) => (kind === 'bool' ? FFIType.u8 : FFIType.u64)),
  ];
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

/** Register an ObjC class whose IMPs are JSCallbacks (D026); throws off macOS. */
export const defineObjcClass = (
  name: string,
  superclassName: string,
  methods: ReadonlyArray<ObjcMethodSpec>,
): Handle => {
  const runtime = getRuntime();
  const rt = cocoa();
  const superclass = rt.classes.get(superclassName);
  const cls = runtime.symbols.objc_allocateClassPair(superclass, cstr(name), 0n);
  // Nil means the name is taken; class_addMethod on nil corrupts silently.
  if (cls === 0n) {
    throw new BunmaskaError(
      `defineObjcClass: objc_allocateClassPair returned nil for ${JSON.stringify(name)} - the class name is already registered in this process`,
    );
  }

  for (const method of methods) {
    const callback = buildCallback(method);
    retainedCallbacks.push(callback);
    if (
      callback.ptr === null ||
      runtime.symbols.class_addMethod(
        cls,
        rt.selectors.get(method.selector),
        BigInt(callback.ptr),
        cstr(method.typeEncoding),
      ) === 0
    ) {
      throw new BunmaskaError(
        `defineObjcClass: could not add ${method.selector} to ${name} (a duplicate selector, or no IMP)`,
      );
    }
  }

  runtime.symbols.objc_registerClassPair(cls);
  return cls;
};

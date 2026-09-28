import { cstr } from '../cstr';
import { ClassCache } from './cocoa-class-cache';
import { loadCocoaFFI } from './cocoa-ffi';
import { SelectorCache } from './cocoa-selector-cache';
import type { Handle } from './objc';

export type CocoaRuntime = {
  readonly selectors: SelectorCache;
  readonly classes: ClassCache;
  readonly msgSend: (receiver: Handle, selector: Handle) => Handle;
};

let cached: CocoaRuntime | undefined;

/** The lazy process-wide Cocoa runtime (D017); throws off macOS. */
export const cocoa = (): CocoaRuntime => {
  if (cached !== undefined) {
    return cached;
  }

  const ffi = loadCocoaFFI();

  cached = {
    selectors: new SelectorCache((name) => ffi.symbols.sel_registerName(cstr(name))),
    classes: new ClassCache((name) => ffi.symbols.objc_getClass(cstr(name))),
    msgSend: (receiver, selector) => ffi.symbols.objc_msgSend(receiver, selector),
  };
  return cached;
};

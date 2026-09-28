import { FFIType } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { LIBOBJC_PATH, macOSLibraryAccessor } from './objc';

const FOUNDATION_PATH = '/System/Library/Frameworks/Foundation.framework/Foundation';
const APPKIT_PATH = '/System/Library/Frameworks/AppKit.framework/AppKit';

const FOUNDATION_SYMBOLS = {
  NSGetSizeAndAlignment: {
    args: [FFIType.cstring, FFIType.pointer, FFIType.pointer],
    returns: FFIType.cstring,
  },
};

const APPKIT_SYMBOLS = {
  NSApplicationMain: {
    args: [FFIType.i32, FFIType.pointer],
    returns: FFIType.i32,
  },
};

/**
 * Open libobjc, and Foundation + AppKit so their classes register. Bun needs one declared
 * symbol per dlopen, so the framework anchors are never called; shared-cache images never
 * unload, so their handles are dropped.
 */
export const loadCocoaFFI = macOSLibraryAccessor('loadCocoaFFI()', () => {
  dlopen(FOUNDATION_PATH, FOUNDATION_SYMBOLS);
  dlopen(APPKIT_PATH, APPKIT_SYMBOLS);

  // D029, stated once here: every ObjC handle slot (id/SEL/Class/IMP) is u64, never
  // pointer. A tagged pointer (short NSString/NSNumber/NSDate) sets bits above 2^53
  // that pointer truncates to a corrupt f64; sending to that handle segfaults.
  return dlopen(LIBOBJC_PATH, {
    sel_registerName: {
      args: [FFIType.cstring],
      returns: FFIType.u64,
    },
    objc_getClass: {
      args: [FFIType.cstring],
      returns: FFIType.u64,
    },
    objc_msgSend: {
      args: [FFIType.u64, FFIType.u64],
      returns: FFIType.u64,
    },
  });
});

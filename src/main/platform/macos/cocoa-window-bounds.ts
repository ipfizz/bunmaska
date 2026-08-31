/**
 * Real NSWindow frame geometry via the CGWindowList, beating the
 * no-struct-return wall: `-[NSWindow frame]` returns NSRect by value (blocked,
 * D018), but `CGRectMakeWithDictionaryRepresentation` fills a caller-allocated
 * OUT buffer. `kCGWindowBounds` is GLOBAL TOP-LEFT and frame-inclusive, which is
 * exactly Electron's `getBounds` contract, so no coordinate flip on reads.
 */

import { dlopen, FFIType, ptr } from 'bun:ffi';
import type { Rect } from '../native';
import { nsString } from './cocoa-foundation';
import { msgSendI64, msgSendPtr, msgSendReturnsI64 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import type { Handle } from './objc';

const CORE_GRAPHICS = '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics';

// (CGWindowListOption, CGWindowID) -> CFArrayRef (+1, caller releases)
// (CFDictionaryRef, CGRect* out) -> bool; fills 4 x f64 [x, y, w, h]
const SYMBOLS = {
  CGWindowListCopyWindowInfo: { args: [FFIType.u32, FFIType.u32], returns: FFIType.u64 },
  CGRectMakeWithDictionaryRepresentation: {
    args: [FFIType.u64, FFIType.ptr],
    returns: FFIType.u8,
  },
} as const;

const OPTION_INCLUDING_WINDOW = 1 << 3; // kCGWindowListOptionIncludingWindow

let cg: ReturnType<typeof dlopen<typeof SYMBOLS>> | undefined;

const loadCoreGraphics = (): ReturnType<typeof dlopen<typeof SYMBOLS>> => {
  cg ??= dlopen(CORE_GRAPHICS, SYMBOLS);
  return cg;
};

/**
 * The window's on-screen frame in global top-left coordinates, or `undefined`
 * when the window server does not list it (hidden/never-shown windows) - the
 * caller falls back to its tracked bounds then.
 */
export const readWindowBounds = (window: Handle): Rect | undefined => {
  const rt = cocoa();
  const windowNumber = msgSendReturnsI64(window, rt.selectors.get('windowNumber'));
  if (windowNumber <= 0n) {
    return undefined;
  }
  const symbols = loadCoreGraphics().symbols;
  const list = symbols.CGWindowListCopyWindowInfo(OPTION_INCLUDING_WINDOW, Number(windowNumber));
  if (list === 0n) {
    return undefined;
  }
  try {
    // The copied CFArray is toll-free NSArray; one entry when listed, none when not.
    const count = Number(msgSendReturnsI64(list, rt.selectors.get('count')));
    if (count === 0) {
      return undefined;
    }
    const dict = msgSendI64(list, rt.selectors.get('objectAtIndex:'), 0n);
    const boundsDict = msgSendPtr(
      dict,
      rt.selectors.get('objectForKey:'),
      nsString('kCGWindowBounds'),
    );
    if (boundsDict === 0n) {
      return undefined;
    }
    const out = new Float64Array(4);
    if (symbols.CGRectMakeWithDictionaryRepresentation(boundsDict, ptr(out.buffer)) === 0) {
      return undefined;
    }
    const x = out[0] ?? 0;
    const y = out[1] ?? 0;
    const width = out[2] ?? 0;
    const height = out[3] ?? 0;
    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    };
  } finally {
    // +1 from the Copy; toll-free bridged, so ObjC release balances it.
    rt.msgSend(list, rt.selectors.get('release'));
  }
};

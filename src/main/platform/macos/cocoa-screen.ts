import { FFIType, ptr } from 'bun:ffi';
import { dlopen } from '../dlopen';
import type { Point, RawDisplay, ScreenBackend } from '../../api/screen';
import type { Rect } from '../native';
import { nsString } from './cocoa-foundation';
import {
  msgSendI64,
  msgSendPtr,
  msgSendPtrI64,
  msgSendReturnsF64,
  msgSendReturnsI64,
} from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { CORE_GRAPHICS_PATH } from './core-graphics-image-ffi';
import { type Handle, macOSLibraryAccessor } from './objc';

// bun:ffi cannot return an NSRect/NSPoint struct, so geometry goes through KVC (valueForKey:
// boxes it in an NSValue) and is copied out with getValue:size:.

const CG_SYMBOLS = {
  CGGetActiveDisplayList: {
    args: [FFIType.u32, FFIType.pointer, FFIType.pointer],
    returns: FFIType.i32,
  },
  CGMainDisplayID: { args: [], returns: FFIType.u32 },
  CGDisplayPixelsWide: { args: [FFIType.u32], returns: FFIType.u64 },
  CGDisplayPixelsHigh: { args: [FFIType.u32], returns: FFIType.u64 },
  CGDisplayRotation: { args: [FFIType.u32], returns: FFIType.f64 },
  CGDisplayIsBuiltin: { args: [FFIType.u32], returns: FFIType.u32 },
  CGDisplayIsMain: { args: [FFIType.u32], returns: FFIType.u32 },
  CGDisplayCopyDisplayMode: { args: [FFIType.u32], returns: FFIType.pointer },
  CGDisplayModeGetWidth: { args: [FFIType.pointer], returns: FFIType.u64 },
  CGDisplayModeGetPixelWidth: { args: [FFIType.pointer], returns: FFIType.u64 },
  CGDisplayModeRelease: { args: [FFIType.pointer], returns: FFIType.void },
} as const;

export const loadCoreGraphicsFFI = macOSLibraryAccessor('CoreGraphics screen', () =>
  dlopen(CORE_GRAPHICS_PATH, CG_SYMBOLS),
);

type CGSymbols = ReturnType<typeof loadCoreGraphicsFFI>['symbols'];

const MAX_DISPLAYS = 32;

/** scaleFactor = physical / logical width of the display's current mode (>= 1). */
const scaleFactorFor = (symbols: CGSymbols, id: number): number => {
  const mode = symbols.CGDisplayCopyDisplayMode(id);
  if (mode === null) {
    return 1;
  }
  const logical = Number(symbols.CGDisplayModeGetWidth(mode));
  const physical = Number(symbols.CGDisplayModeGetPixelWidth(mode));
  symbols.CGDisplayModeRelease(mode);
  return logical > 0 ? physical / logical : 1;
};

/** CoreGraphics-only fallback for when AppKit lists no screens: origin (0,0), workArea = bounds. */
const cgDisplayFor = (symbols: CGSymbols, id: number): RawDisplay => {
  const bounds = {
    x: 0,
    y: 0,
    width: Number(symbols.CGDisplayPixelsWide(id)),
    height: Number(symbols.CGDisplayPixelsHigh(id)),
  };
  return {
    id,
    bounds,
    workArea: bounds,
    scaleFactor: scaleFactorFor(symbols, id),
    rotation: symbols.CGDisplayRotation(id),
    internal: symbols.CGDisplayIsBuiltin(id) === 1,
    primary: symbols.CGDisplayIsMain(id) === 1,
  };
};

const cgDisplays = (symbols: CGSymbols): RawDisplay[] => {
  const ids = new Uint32Array(MAX_DISPLAYS);
  const count = new Uint32Array(1);
  const err = symbols.CGGetActiveDisplayList(MAX_DISPLAYS, ptr(ids), ptr(count));
  const found = count[0] ?? 0;
  if (err !== 0 || found === 0) {
    return [cgDisplayFor(symbols, symbols.CGMainDisplayID())];
  }
  return Array.from(ids.subarray(0, found), (id) => cgDisplayFor(symbols, id));
};

/** Copy `count` doubles out of the NSValue that `[object valueForKey:key]` boxes. */
const readBoxed = (object: Handle, key: string, count: number): Float64Array => {
  const rt = cocoa();
  const value = msgSendPtr(object, rt.selectors.get('valueForKey:'), nsString(key));
  const out = new Float64Array(count);
  msgSendPtrI64(value, rt.selectors.get('getValue:size:'), BigInt(ptr(out)), BigInt(count * 8));
  return out;
};

/** A Cocoa bottom-left rect as top-left global coordinates; `primaryHeight` is the flip pivot. */
const flipRect = (
  [x = 0, y = 0, width = 0, height = 0]: Float64Array,
  primaryHeight: number,
): Rect => ({
  x,
  y: primaryHeight - (y + height),
  width,
  height,
});

const screens = (): Handle[] => {
  const rt = cocoa();
  const list = rt.msgSend(rt.classes.get('NSScreen'), rt.selectors.get('screens'));
  const count = Number(msgSendReturnsI64(list, rt.selectors.get('count')));
  return Array.from({ length: count }, (_, i) =>
    msgSendI64(list, rt.selectors.get('objectAtIndex:'), BigInt(i)),
  );
};

/** Height of the menu-bar screen, which AppKit always lists first at the global origin. */
const primaryHeightOf = (all: readonly Handle[]): number => {
  const [primary] = all;
  return primary === undefined ? 0 : (readBoxed(primary, 'frame', 4)[3] ?? 0);
};

const screenNumber = (screen: Handle): number => {
  const rt = cocoa();
  const description = rt.msgSend(screen, rt.selectors.get('deviceDescription'));
  const number = msgSendPtr(
    description,
    rt.selectors.get('objectForKey:'),
    nsString('NSScreenNumber'),
  );
  return Number(msgSendReturnsI64(number, rt.selectors.get('unsignedIntValue')) & 0xffffffffn);
};

/** Primary display height (pt) - the top-left <-> bottom-left flip pivot. */
export const primaryDisplayHeight = (): number => {
  const symbols = loadCoreGraphicsFFI().symbols;
  return Number(symbols.CGDisplayPixelsHigh(symbols.CGMainDisplayID()));
};

/** The active displays in top-left global coordinates. */
export const getDisplays = (): readonly RawDisplay[] => {
  const { symbols } = loadCoreGraphicsFFI();
  const all = screens();
  if (all.length === 0) {
    return cgDisplays(symbols);
  }
  const primaryHeight = primaryHeightOf(all);
  return all.map((screen) => {
    const id = screenNumber(screen);
    return {
      id,
      bounds: flipRect(readBoxed(screen, 'frame', 4), primaryHeight),
      workArea: flipRect(readBoxed(screen, 'visibleFrame', 4), primaryHeight),
      scaleFactor: msgSendReturnsF64(screen, cocoa().selectors.get('backingScaleFactor')),
      rotation: symbols.CGDisplayRotation(id),
      internal: symbols.CGDisplayIsBuiltin(id) === 1,
      primary: symbols.CGDisplayIsMain(id) === 1,
    };
  });
};

export const getCursorScreenPoint = (): Point => {
  const [x = 0, y = 0] = readBoxed(cocoa().classes.get('NSEvent'), 'mouseLocation', 2);
  return { x, y: primaryHeightOf(screens()) - y };
};

export const cocoaScreenBackend: ScreenBackend = {
  getDisplays,
  getCursorScreenPoint,
};

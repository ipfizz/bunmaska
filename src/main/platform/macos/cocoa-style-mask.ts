/**
 * Compose a Cocoa `NSWindowStyleMask` value from a high-level style description.
 * The bit positions are Cocoa ABI; see AppKit/NSWindow.h for the canonical values.
 */

export type CocoaWindowStyle = {
  readonly titled?: boolean;
  readonly closable?: boolean;
  readonly miniaturizable?: boolean;
  readonly resizable?: boolean;
};

const STYLE_BITS = {
  titled: 1 << 0,
  closable: 1 << 1,
  miniaturizable: 1 << 2,
  resizable: 1 << 3,
} as const;

export const STANDARD_WINDOW_STYLE: CocoaWindowStyle = Object.freeze({
  titled: true,
  closable: true,
  miniaturizable: true,
  resizable: true,
});

export const computeWindowStyleMask = (style: CocoaWindowStyle): number => {
  let mask = 0;
  if (style.titled === true) {
    mask |= STYLE_BITS.titled;
  }
  if (style.closable === true) {
    mask |= STYLE_BITS.closable;
  }
  if (style.miniaturizable === true) {
    mask |= STYLE_BITS.miniaturizable;
  }
  if (style.resizable === true) {
    mask |= STYLE_BITS.resizable;
  }
  return mask;
};

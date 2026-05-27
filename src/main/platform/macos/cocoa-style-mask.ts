/**
 * Compose a Cocoa `NSWindowStyleMask` value from a high-level style description.
 *
 * Pure bit-packing helper — no FFI, no side effects. Lives in `platform/macos/`
 * because the bit positions are part of the Cocoa ABI; consumers should not
 * import this directly except from the macOS native binding layer.
 *
 * See AppKit/NSWindow.h for the canonical enum values.
 */

export type CocoaWindowStyle = {
  readonly titled?: boolean;
  readonly closable?: boolean;
  readonly miniaturizable?: boolean;
  readonly resizable?: boolean;
  readonly utility?: boolean;
  readonly fullSizeContentView?: boolean;
};

const STYLE_BITS = {
  titled: 1 << 0,
  closable: 1 << 1,
  miniaturizable: 1 << 2,
  resizable: 1 << 3,
  utility: 1 << 4,
  fullSizeContentView: 1 << 15,
} as const;

export const STANDARD_WINDOW_STYLE: CocoaWindowStyle = Object.freeze({
  titled: true,
  closable: true,
  miniaturizable: true,
  resizable: true,
});

export const BORDERLESS_WINDOW_STYLE: CocoaWindowStyle = Object.freeze({});

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
  if (style.utility === true) {
    mask |= STYLE_BITS.utility;
  }
  if (style.fullSizeContentView === true) {
    mask |= STYLE_BITS.fullSizeContentView;
  }
  return mask;
};

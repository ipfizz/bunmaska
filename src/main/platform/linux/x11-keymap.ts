import type { ParsedAccelerator } from '../../../common/accelerator';

/** X11 modifier mask bits (`X.h`). */
export const SHIFT_MASK = 1 << 0;
export const CONTROL_MASK = 1 << 2;
export const MOD1_MASK = 1 << 3; // Alt
export const MOD4_MASK = 1 << 6; // Super

/** `KeyPress` event type and the XEvent byte offsets we read (64-bit ABI). */
export const KEY_PRESS = 2;
export const XEVENT_TYPE_OFFSET = 0;
/** XKeyEvent.state (uint) sits at 80, directly before keycode (Xlib.h, x64). */
export const XKEY_STATE_OFFSET = 80;
export const XKEY_KEYCODE_OFFSET = 84;
export const XEVENT_BUFFER_SIZE = 192;

/**
 * The lock-bit grab variants: `XGrabKey(mods)` never fires while NumLock or
 * CapsLock is on, so every registration grabs all four combinations.
 */
export const GRAB_VARIANTS: readonly number[] = [0, 1 << 1, 1 << 4, (1 << 1) | (1 << 4)];

const REGISTRABLE_MODIFIERS = SHIFT_MASK | CONTROL_MASK | MOD1_MASK | MOD4_MASK;

/** Compares only the registrable modifiers: `state` also carries lock, pointer-button and XKB group bits. */
export const x11StateMatches = (state: number, modifiers: number): boolean =>
  (state & REGISTRABLE_MODIFIERS) === modifiers;

/** Accelerator key names to `XStringToKeysym` names. */
const KEYSYM_NAMES: ReadonlyMap<string, string> = new Map([
  ['SPACE', 'space'],
  ['TAB', 'Tab'],
  ['RETURN', 'Return'],
  ['ESCAPE', 'Escape'],
  ['BACKSPACE', 'BackSpace'],
  ['DELETE', 'Delete'],
  ['UP', 'Up'],
  ['DOWN', 'Down'],
  ['LEFT', 'Left'],
  ['RIGHT', 'Right'],
  ['HOME', 'Home'],
  ['END', 'End'],
  ['PAGEUP', 'Prior'],
  ['PAGEDOWN', 'Next'],
  ['PLUS', 'plus'],
  ['INSERT', 'Insert'],
  ['NUMDEC', 'KP_Decimal'],
  ['NUMMULT', 'KP_Multiply'],
  ['NUMADD', 'KP_Add'],
  ['NUMDIV', 'KP_Divide'],
  ['NUMSUB', 'KP_Subtract'],
  ...Array.from({ length: 10 }, (_, digit): [string, string] => [`NUM${digit}`, `KP_${digit}`]),
  // ponytail: no media/volume keys; their XF86Audio* keysyms usually belong to the desktop.
]);

const isFunctionKey = (key: string): boolean => /^F([1-9]|1[0-9]|2[0-4])$/.test(key);

/** The keysym NAME for `XStringToKeysym`, or `undefined` when X cannot express the key. */
export const x11KeysymName = (key: string): string | undefined => {
  const upper = key.toUpperCase();
  if (key.length === 1) {
    // XStringToKeysym takes names ('comma'), not characters; `U<hex>` names any character.
    return /[A-Z0-9]/.test(upper)
      ? upper.toLowerCase()
      : `U${key.toLowerCase().charCodeAt(0).toString(16)}`;
  }
  if (isFunctionKey(upper)) {
    return upper;
  }
  return KEYSYM_NAMES.get(upper);
};

export const x11ModifierMask = (parsed: ParsedAccelerator): number => {
  let mask = 0;
  if (parsed.shift) {
    mask |= SHIFT_MASK;
  }
  if (parsed.ctrl) {
    mask |= CONTROL_MASK;
  }
  if (parsed.alt) {
    mask |= MOD1_MASK;
  }
  // Super and Cmd both map to Mod4.
  if (parsed.super || parsed.meta) {
    mask |= MOD4_MASK;
  }
  return mask;
};

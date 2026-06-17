import type { ParsedAccelerator } from '../../api/accelerator';

/**
 * Pure X11 keysym-name + modifier-mask mapping for the Linux global-shortcut
 * backend. No FFI here — these map a parsed accelerator onto the X keysym NAME
 * (resolved to a real keysym via `XStringToKeysym` at registration time) and the
 * X modifier mask. Unit-tested directly.
 */

/** X11 modifier mask bits (`X.h`). */
export const SHIFT_MASK = 1 << 0; // 1
export const CONTROL_MASK = 1 << 2; // 4
export const MOD1_MASK = 1 << 3; // 8  (Alt)
export const MOD4_MASK = 1 << 6; // 64 (Super)

/** `KeyPress` event type and the XEvent byte offsets we read (64-bit ABI). */
export const KEY_PRESS = 2;
export const XEVENT_TYPE_OFFSET = 0;
export const XKEY_KEYCODE_OFFSET = 84;
export const XEVENT_BUFFER_SIZE = 192;

/** `KeyPressMask` for `XSelectInput` (`X.h`). */
export const KEY_PRESS_MASK = 1 << 0; // 1

/** Named keys → the X keysym string `XStringToKeysym` understands. */
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
]);

const isFunctionKey = (key: string): boolean => /^F([1-9]|1[0-9]|2[0-4])$/.test(key);

/**
 * Map a parsed accelerator key to the X keysym NAME string for
 * `XStringToKeysym`, or `undefined` if it cannot be expressed. Single letters
 * become their lowercase form (`'K'` → `'k'`); digits stay as-is.
 */
export const x11KeysymName = (key: string): string | undefined => {
  const upper = key.toUpperCase();
  if (key.length === 1) {
    return /[A-Z]/.test(upper) ? upper.toLowerCase() : key;
  }
  if (isFunctionKey(upper)) {
    return upper;
  }
  return KEYSYM_NAMES.get(upper);
};

/** Build the X modifier mask for a parsed accelerator (CmdOrCtrl already resolved). */
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
  // On Linux, Super (and Cmd-as-meta, which CmdOrCtrl never sets here) maps to Mod4.
  if (parsed.super || parsed.meta) {
    mask |= MOD4_MASK;
  }
  return mask;
};

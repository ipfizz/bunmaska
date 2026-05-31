import type { ParsedAccelerator } from '../../api/accelerator';

/**
 * Pure macOS-virtual-key-code + Carbon-modifier-mask tables for the Carbon
 * global-shortcut backend.
 *
 * Carbon's `RegisterEventHotKey` wants a hardware virtual key code (US layout)
 * and a modifier mask, NOT a character. These tables map our parsed accelerator
 * key/modifiers onto those. Values are the canonical `kVK_*` constants from
 * `HIToolbox/Events.h`. No FFI lives here so the mapping is unit-testable.
 */

/** Carbon modifier mask bits (Events.h `cmdKey`, `shiftKey`, `optionKey`, `controlKey`). */
export const CMD_KEY = 0x100;
export const SHIFT_KEY = 0x200;
export const OPTION_KEY = 0x800;
export const CONTROL_KEY = 0x1000;

/** US-layout virtual key codes keyed by normalised key label (`kVK_ANSI_*` / `kVK_*`). */
const VIRTUAL_KEY_CODES: ReadonlyMap<string, number> = new Map([
  ['A', 0],
  ['S', 1],
  ['D', 2],
  ['F', 3],
  ['H', 4],
  ['G', 5],
  ['Z', 6],
  ['X', 7],
  ['C', 8],
  ['V', 9],
  ['B', 11],
  ['Q', 12],
  ['W', 13],
  ['E', 14],
  ['R', 15],
  ['Y', 16],
  ['T', 17],
  ['1', 18],
  ['2', 19],
  ['3', 20],
  ['4', 21],
  ['6', 22],
  ['5', 23],
  ['=', 24],
  ['9', 25],
  ['7', 26],
  ['-', 27],
  ['8', 28],
  ['0', 29],
  [']', 30],
  ['O', 31],
  ['U', 32],
  ['[', 33],
  ['I', 34],
  ['P', 35],
  ['RETURN', 36],
  ['L', 37],
  ['J', 38],
  ["'", 39],
  ['K', 40],
  [';', 41],
  ['\\', 42],
  [',', 43],
  ['/', 44],
  ['N', 45],
  ['M', 46],
  ['.', 47],
  ['TAB', 48],
  ['SPACE', 49],
  ['`', 50],
  ['BACKSPACE', 51],
  ['ESCAPE', 53],
  ['LEFT', 123],
  ['RIGHT', 124],
  ['DOWN', 125],
  ['UP', 126],
  ['HOME', 115],
  ['END', 119],
  ['PAGEUP', 116],
  ['PAGEDOWN', 121],
  ['DELETE', 117],
  ['F1', 122],
  ['F2', 120],
  ['F3', 99],
  ['F4', 118],
  ['F5', 96],
  ['F6', 97],
  ['F7', 98],
  ['F8', 100],
  ['F9', 101],
  ['F10', 109],
  ['F11', 103],
  ['F12', 111],
  ['F13', 105],
  ['F14', 107],
  ['F15', 113],
]);

/**
 * Map a parsed accelerator key to a macOS virtual key code, or `undefined` if
 * the key has no entry in the US-layout table.
 */
export const macVirtualKeyCode = (key: string): number | undefined =>
  VIRTUAL_KEY_CODES.get(key.toUpperCase());

/** Build the Carbon modifier mask for a parsed accelerator (CmdOrCtrl already resolved). */
export const carbonModifierMask = (parsed: ParsedAccelerator): number => {
  let mask = 0;
  if (parsed.meta) {
    mask |= CMD_KEY;
  }
  if (parsed.shift) {
    mask |= SHIFT_KEY;
  }
  if (parsed.alt) {
    mask |= OPTION_KEY;
  }
  if (parsed.ctrl) {
    mask |= CONTROL_KEY;
  }
  return mask;
};

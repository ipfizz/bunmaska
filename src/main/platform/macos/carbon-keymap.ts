import type { ParsedAccelerator } from '../../../common/accelerator';

/** Carbon modifier mask bits (Events.h `cmdKey`, `shiftKey`, `optionKey`, `controlKey`). */
export const CMD_KEY = 0x100;
export const SHIFT_KEY = 0x200;
export const OPTION_KEY = 0x800;
export const CONTROL_KEY = 0x1000;

/** Carbon wants hardware key codes, not characters: US-layout `kVK_*` values from Events.h. */
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
  ['PLUS', 24],
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
  ['F16', 106],
  ['F17', 64],
  ['F18', 79],
  ['F19', 80],
  ['F20', 90],
  ['INSERT', 114],
  ['NUMDEC', 65],
  ['NUMMULT', 67],
  ['NUMADD', 69],
  ['NUMDIV', 75],
  ['NUMSUB', 78],
  ['NUM0', 82],
  ['NUM1', 83],
  ['NUM2', 84],
  ['NUM3', 85],
  ['NUM4', 86],
  ['NUM5', 87],
  ['NUM6', 88],
  ['NUM7', 89],
  ['NUM8', 91],
  ['NUM9', 92],
  // ponytail: media/volume keys are NX_SYSDEFINED events Carbon cannot grab; add them via a CGEventTap.
]);

/** The US-layout virtual key code for a parsed accelerator key, or `undefined` if unmapped. */
export const macVirtualKeyCode = (key: string): number | undefined =>
  VIRTUAL_KEY_CODES.get(key.toUpperCase());

/** Build the Carbon modifier mask for a parsed accelerator (CmdOrCtrl already resolved). */
export const carbonModifierMask = (parsed: ParsedAccelerator): number => {
  let mask = 0;
  // Super/Meta is Cmd on macOS (Electron); dropping super turns 'Super+K' into a bare-K grab.
  if (parsed.meta || parsed.super) {
    mask |= CMD_KEY;
  }
  // Plus is the shifted =/+ key; Electron adds Shift for it too.
  if (parsed.shift || parsed.key.toUpperCase() === 'PLUS') {
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

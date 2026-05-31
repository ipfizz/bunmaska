import type { Platform } from '../../common/platform';

/**
 * Shared, pure accelerator parsing for the `globalShortcut` module (and a richer
 * superset of what `menu.ts` needs).
 *
 * An accelerator is Electron's `'CmdOrCtrl+Shift+K'` string: zero or more
 * modifier tokens and exactly one final key, joined by `+`. Parsing is pure and
 * platform-parameterised so `CmdOrCtrl` resolves correctly without touching any
 * FFI: `CmdOrCtrl` = Command (meta) on macOS, Control on Linux.
 *
 * Unparseable accelerators (empty, no key, two keys, unknown token) parse to
 * `undefined` so callers — notably `globalShortcut.register` — can reject them.
 */

/** A parsed accelerator: its final key plus the modifier flags it requests. */
export type ParsedAccelerator = {
  /** The final, non-modifier key, normalised (single letters upper-cased). */
  readonly key: string;
  /** Whether the original string used the platform-relative `CmdOrCtrl` token. */
  readonly cmdOrCtrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
  /** The Command key on macOS (Cmd/Command). */
  readonly meta: boolean;
  /** The Super/Windows key (Super/Meta token). */
  readonly super: boolean;
};

type Modifiers = {
  cmdOrCtrl: boolean;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  super: boolean;
};

/** Named keys accepted as a final key (case-insensitive), normalised to a canonical label. */
const NAMED_KEYS = new Map<string, string>([
  ['space', 'Space'],
  ['tab', 'Tab'],
  ['return', 'Return'],
  ['enter', 'Return'],
  ['escape', 'Escape'],
  ['esc', 'Escape'],
  ['backspace', 'Backspace'],
  ['delete', 'Delete'],
  ['up', 'Up'],
  ['down', 'Down'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['home', 'Home'],
  ['end', 'End'],
  ['pageup', 'PageUp'],
  ['pagedown', 'PageDown'],
  ['plus', 'Plus'],
]);

const isFunctionKey = (token: string): boolean => /^f([1-9]|1[0-9]|2[0-4])$/i.test(token);

const normaliseKey = (token: string): string | undefined => {
  if (token.length === 0) {
    return undefined;
  }
  if (token.length === 1) {
    // Single letter or digit (or punctuation) — upper-case letters for stability.
    return token.toUpperCase();
  }
  if (isFunctionKey(token)) {
    return token.toUpperCase();
  }
  return NAMED_KEYS.get(token.toLowerCase());
};

/** Apply a modifier token; returns false if the token is not a known modifier. */
const applyModifier = (token: string, mods: Modifiers): boolean => {
  switch (token.toLowerCase()) {
    case 'cmdorctrl':
    case 'commandorcontrol':
      mods.cmdOrCtrl = true;
      return true;
    case 'cmd':
    case 'command':
      mods.meta = true;
      return true;
    case 'ctrl':
    case 'control':
      mods.ctrl = true;
      return true;
    case 'alt':
    case 'option':
      mods.alt = true;
      return true;
    case 'shift':
      mods.shift = true;
      return true;
    case 'super':
    case 'meta':
      mods.super = true;
      return true;
    default:
      return false;
  }
};

/**
 * Parse an accelerator into its key and modifier flags for `platform`, or
 * `undefined` if it cannot be parsed. `CmdOrCtrl` is preserved as a flag AND
 * resolved into the concrete `meta`/`ctrl` flag for the platform.
 */
export const parseAccelerator = (
  accelerator: string,
  platform: Platform,
): ParsedAccelerator | undefined => {
  const tokens = accelerator
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return undefined;
  }

  const mods: Modifiers = {
    cmdOrCtrl: false,
    shift: false,
    alt: false,
    ctrl: false,
    meta: false,
    super: false,
  };

  let key: string | undefined;
  for (const token of tokens) {
    if (applyModifier(token, mods)) {
      continue;
    }
    const candidate = normaliseKey(token);
    if (candidate === undefined) {
      return undefined; // unknown token
    }
    if (key !== undefined) {
      return undefined; // more than one final key
    }
    key = candidate;
  }

  if (key === undefined) {
    return undefined; // modifiers but no key
  }

  // Resolve CmdOrCtrl into the concrete platform modifier.
  const meta = mods.meta || (mods.cmdOrCtrl && platform === 'macos');
  const ctrl = mods.ctrl || (mods.cmdOrCtrl && platform !== 'macos');

  return {
    key,
    cmdOrCtrl: mods.cmdOrCtrl,
    shift: mods.shift,
    alt: mods.alt,
    ctrl,
    meta,
    super: mods.super,
  };
};

import type { Platform } from '../../common/platform';

/**
 * Accelerator parsing: Electron's `'CmdOrCtrl+Shift+K'` — zero or more modifier
 * tokens and EXACTLY ONE final key, joined by `+`. `CmdOrCtrl` resolves to
 * Command (meta) on macOS, Control everywhere else. Empty, keyless, two-key and
 * unknown-token accelerators parse to `undefined` so callers can reject them.
 */

export type ParsedAccelerator = {
  /** Normalised: single letters are upper-cased. */
  readonly key: string;
  /** Whether the original string used the platform-relative `CmdOrCtrl` token. */
  readonly cmdOrCtrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
  /** The Command key on macOS — from a `Cmd`/`Command` token. */
  readonly meta: boolean;
  /** The Super/Windows key — from a `Super`/`Meta` token. */
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

/** Case-insensitive, normalised to a canonical label. */
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
    return token.toUpperCase();
  }
  if (isFunctionKey(token)) {
    return token.toUpperCase();
  }
  return NAMED_KEYS.get(token.toLowerCase());
};

/** Returns false when the token is not a known modifier. */
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
 * `undefined` when the accelerator cannot be parsed. `CmdOrCtrl` is preserved as
 * a flag AND resolved into the concrete `meta`/`ctrl` flag for `platform`.
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

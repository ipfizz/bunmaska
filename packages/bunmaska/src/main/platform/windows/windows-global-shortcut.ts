import { parseAccelerator } from '../../api/accelerator';
import type { GlobalShortcutBackend } from '../../api/global-shortcut';
import { loadUser32 } from './win32-ffi';

/**
 * Windows `globalShortcut` backend (pure `bun:ffi`), the WinCairo peer of the
 * Carbon (macOS) and X11 (Linux) backends. `RegisterHotKey(NULL, id, …)` claims a
 * system-wide hot key and posts `WM_HOTKEY` to the calling (Bun main) thread's
 * queue; the cooperative pump's message inspector routes that message back here
 * via {@link WindowsGlobalShortcutBackend.dispatchHotkeyMessage}, which fires the
 * registered callback. Accelerator → virtual-key/modifier translation is a pure
 * function so it unit-tests with no FFI.
 */

/** `WM_HOTKEY` — posted when a registered hot key fires; `wParam` is the hot-key id. */
export const WM_HOTKEY = 0x0312;

// RegisterHotKey `fsModifiers` flags.
const MOD_ALT = 0x0001;
const MOD_CONTROL = 0x0002;
const MOD_SHIFT = 0x0004;
const MOD_WIN = 0x0008;
/** Suppress auto-repeat while the key is held (one WM_HOTKEY per press). */
const MOD_NOREPEAT = 0x4000;

const VK_F1 = 0x70;

/** Virtual-key codes for the named keys `parseAccelerator` emits. */
const NAMED_VK = new Map<string, number>([
  ['Space', 0x20],
  ['Tab', 0x09],
  ['Return', 0x0d],
  ['Escape', 0x1b],
  ['Backspace', 0x08],
  ['Delete', 0x2e],
  ['Up', 0x26],
  ['Down', 0x28],
  ['Left', 0x25],
  ['Right', 0x27],
  ['Home', 0x24],
  ['End', 0x23],
  ['PageUp', 0x21],
  ['PageDown', 0x22],
  ['Plus', 0xbb], // VK_OEM_PLUS
]);

/** Common US-layout OEM punctuation virtual-key codes (layout-dependent). */
const PUNCTUATION_VK = new Map<string, number>([
  ['-', 0xbd],
  ['=', 0xbb],
  ['[', 0xdb],
  [']', 0xdd],
  ['\\', 0xdc],
  [';', 0xba],
  ["'", 0xde],
  [',', 0xbc],
  ['.', 0xbe],
  ['/', 0xbf],
  ['`', 0xc0],
]);

const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;

/** Map a normalised accelerator key to its Windows virtual-key code, or undefined. */
const keyToVirtualKey = (key: string): number | undefined => {
  if (key.length === 1) {
    const code = key.charCodeAt(0);
    // A–Z (0x41–0x5A) and 0–9 (0x30–0x39) map to their character code directly.
    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x30 && code <= 0x39)) {
      return code;
    }
    return PUNCTUATION_VK.get(key);
  }
  const fn = FUNCTION_KEY.exec(key);
  if (fn !== null) {
    return VK_F1 + (Number(key.slice(1)) - 1);
  }
  return NAMED_VK.get(key);
};

/** A Windows hot key: the virtual-key code and the `fsModifiers` bitmask. */
export type Hotkey = { readonly vk: number; readonly modifiers: number };

/**
 * Translate an Electron accelerator string into a Windows hot key, or `undefined`
 * if it is unparseable or its key has no Windows virtual-key code. `MOD_NOREPEAT`
 * is always set so a held key fires once. Pure.
 */
export const acceleratorToHotkey = (accelerator: string): Hotkey | undefined => {
  const parsed = parseAccelerator(accelerator, 'windows');
  if (parsed === undefined) {
    return undefined;
  }
  const vk = keyToVirtualKey(parsed.key);
  if (vk === undefined) {
    return undefined;
  }
  let modifiers = MOD_NOREPEAT;
  if (parsed.ctrl) {
    modifiers |= MOD_CONTROL; // parseAccelerator resolved CmdOrCtrl -> ctrl on Windows
  }
  if (parsed.alt) {
    modifiers |= MOD_ALT;
  }
  if (parsed.shift) {
    modifiers |= MOD_SHIFT;
  }
  if (parsed.super || parsed.meta) {
    modifiers |= MOD_WIN; // Super/Meta (and a stray Cmd) map to the Windows key
  }
  return { vk, modifiers };
};

/** The Windows backend plus the pump hook the cooperative drain calls per message. */
export type WindowsGlobalShortcutBackend = GlobalShortcutBackend & {
  /** Fire the matching callback for a `WM_HOTKEY` message; `true` if it was one. */
  dispatchHotkeyMessage(message: number, wParam: bigint): boolean;
};

/**
 * Build a Windows globalShortcut backend. A factory (not just a singleton) so
 * tests get an isolated id space; production uses {@link windowsGlobalShortcutBackend}.
 */
export const createWindowsGlobalShortcutBackend = (): WindowsGlobalShortcutBackend => {
  const idByAccelerator = new Map<string, number>();
  const callbackById = new Map<number, () => void>();
  let nextId = 1;

  return {
    isSupported: (): boolean => true,

    register(accelerator: string, callback: () => void): boolean {
      const hotkey = acceleratorToHotkey(accelerator);
      if (hotkey === undefined) {
        return false;
      }
      const id = nextId;
      if (loadUser32().symbols.RegisterHotKey(0n, id, hotkey.modifiers, hotkey.vk) === 0) {
        return false; // the OS refused the grab (reserved/already taken)
      }
      nextId += 1;
      idByAccelerator.set(accelerator, id);
      callbackById.set(id, callback);
      return true;
    },

    unregister(accelerator: string): void {
      const id = idByAccelerator.get(accelerator);
      if (id === undefined) {
        return;
      }
      loadUser32().symbols.UnregisterHotKey(0n, id);
      idByAccelerator.delete(accelerator);
      callbackById.delete(id);
    },

    unregisterAll(): void {
      const user32 = loadUser32().symbols;
      for (const id of callbackById.keys()) {
        user32.UnregisterHotKey(0n, id);
      }
      idByAccelerator.clear();
      callbackById.clear();
    },

    dispatchHotkeyMessage(message: number, wParam: bigint): boolean {
      if (message !== WM_HOTKEY) {
        return false;
      }
      const callback = callbackById.get(Number(wParam));
      if (callback === undefined) {
        return false;
      }
      callback();
      return true;
    },
  };
};

/** The process-wide Windows globalShortcut backend (the pump dispatches into it). */
export const windowsGlobalShortcutBackend = createWindowsGlobalShortcutBackend();

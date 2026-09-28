import { parseAccelerator } from '../../api/accelerator';
import type { GlobalShortcutBackend } from '../services';
import { loadUser32 } from './win32-ffi';
import { createMessageWindow, type MessageHandler } from './windows-message-window';

/** `wParam` is the hot-key id. */
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
  ['Insert', 0x2d],
  ['nummult', 0x6a],
  ['numadd', 0x6b],
  ['numsub', 0x6d],
  ['numdec', 0x6e],
  ['numdiv', 0x6f],
  ...Array.from({ length: 10 }, (_, digit): [string, number] => [`num${digit}`, 0x60 + digit]),
  // ponytail: no media/volume keys yet; they are VK_VOLUME_MUTE (0xAD) through VK_MEDIA_PLAY_PAUSE (0xB3).
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

/** The user32 calls the backend makes. */
type HotkeyApi = Pick<
  ReturnType<typeof loadUser32>['symbols'],
  'RegisterHotKey' | 'UnregisterHotKey'
>;

export const createWindowsGlobalShortcutBackend = (
  user32: () => HotkeyApi = () => loadUser32().symbols,
  createWindow: (handler: MessageHandler) => { readonly hwnd: bigint } = createMessageWindow,
): WindowsGlobalShortcutBackend => {
  const idByAccelerator = new Map<string, number>();
  const callbackById = new Map<number, () => void>();

  const dispatchHotkeyMessage = (message: number, wParam: bigint): boolean => {
    if (message !== WM_HOTKEY) {
      return false;
    }
    const callback = callbackById.get(Number(wParam));
    if (callback === undefined) {
      return false;
    }
    callback();
    return true;
  };

  // Never register against the thread (hwnd NULL): a modal loop (message box, menu,
  // window drag) drops thread messages. Posted to this window, WM_HOTKEY reaches the pump's
  // inspector normally and the window's handler while a modal loop runs.
  let window: { readonly hwnd: bigint } | undefined;
  const hotkeyWindow = (): bigint => {
    window ??= createWindow((message, wParam) => {
      dispatchHotkeyMessage(message, wParam);
    });
    return window.hwnd;
  };

  return {
    isSupported: (): boolean => true,

    register(accelerator: string, callback: () => void): boolean {
      const hotkey = acceleratorToHotkey(accelerator);
      if (hotkey === undefined) {
        return false;
      }
      // The lowest free id keeps ids inside RegisterHotKey's app range (0x0000-0xBFFF).
      let id = 1;
      while (callbackById.has(id)) {
        id += 1;
      }
      if (user32().RegisterHotKey(hotkeyWindow(), id, hotkey.modifiers, hotkey.vk) === 0) {
        return false; // the OS refused the grab (reserved/already taken)
      }
      idByAccelerator.set(accelerator, id);
      callbackById.set(id, callback);
      return true;
    },

    unregister(accelerator: string): void {
      const id = idByAccelerator.get(accelerator);
      if (id === undefined) {
        return;
      }
      user32().UnregisterHotKey(hotkeyWindow(), id);
      idByAccelerator.delete(accelerator);
      callbackById.delete(id);
    },

    unregisterAll(): void {
      const api = user32();
      for (const id of callbackById.keys()) {
        api.UnregisterHotKey(hotkeyWindow(), id);
      }
      idByAccelerator.clear();
      callbackById.clear();
    },

    dispatchHotkeyMessage,
  };
};

/** The process-wide Windows globalShortcut backend (the pump dispatches into it). */
export const windowsGlobalShortcutBackend = createWindowsGlobalShortcutBackend();

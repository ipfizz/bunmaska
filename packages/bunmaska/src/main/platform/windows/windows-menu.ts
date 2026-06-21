import { ptr } from 'bun:ffi';
import type { MenuRealizer } from '../../api/menu';
import type { NativeMenuItemSpec } from '../macos/cocoa-menu';
import { wstr } from './win32';
import { loadUser32 } from './win32-ffi';

/**
 * Windows menu realizer, the WinCairo peer of the `NSMenu` (macOS) and GTK
 * (Linux) menu backends. A menu tree is built into a Win32 `HMENU` with
 * `CreatePopupMenu` + `AppendMenuW`; clickable items get a unique command id whose
 * `onClick` is stored here so {@link WindowsMenuRealizer.dispatchMenuCommand} (called
 * by the window after `TrackPopupMenu` returns the chosen id) can fire it. The
 * HMENU build is non-modal (so it is integration-tested); the popup itself is the
 * window's `TrackPopupMenu`, which is modal like macOS menu tracking.
 *
 * v1: context menus (`Menu.popup`). `setApplicationMenu` is a no-op — a Windows
 * menu BAR is per-window (`SetMenu`), not a global bar; wiring it is a follow-up.
 * Role items render as plain labels (their keyboard shortcuts work natively via
 * WebKit / `globalShortcut`); accelerator text in the menu is also a follow-up.
 */

// AppendMenuW flags.
const MF_STRING = 0x0;
const MF_SEPARATOR = 0x800;
const MF_POPUP = 0x10;
const MF_CHECKED = 0x8;
const MF_GRAYED = 0x1;

/** The AppendMenuW flags for a normal/checkbox/radio item. Pure. */
export const menuItemFlags = (enabled: boolean, checked: boolean): number => {
  let flags = MF_STRING;
  if (!enabled) {
    flags |= MF_GRAYED;
  }
  if (checked) {
    flags |= MF_CHECKED;
  }
  return flags;
};

/** The Windows realizer plus the command dispatch the window calls after a popup. */
export type WindowsMenuRealizer = MenuRealizer & {
  /** Fire the `onClick` stored for `commandId` (a `TrackPopupMenu` result). */
  dispatchMenuCommand(commandId: number): void;
};

/**
 * Build a Windows menu realizer. A factory (not just a singleton) so tests get an
 * isolated command-id space; production uses {@link windowsMenuRealizer}.
 */
export const createWindowsMenuRealizer = (): WindowsMenuRealizer => {
  const callbackByCommandId = new Map<number, () => void>();
  let nextCommandId = 1;

  const buildMenu = (items: ReadonlyArray<NativeMenuItemSpec>): bigint => {
    const user32 = loadUser32().symbols;
    const hmenu = user32.CreatePopupMenu();
    for (const item of items) {
      if (item.type === 'separator') {
        user32.AppendMenuW(hmenu, MF_SEPARATOR, 0n, null);
        continue;
      }
      const labelBuffer = wstr(item.label); // copied by AppendMenuW; alive across the call
      if (item.type === 'submenu' && item.submenu !== undefined) {
        const submenu = buildMenu(item.submenu);
        const flags = MF_POPUP | MF_STRING | (item.enabled ? 0 : MF_GRAYED);
        user32.AppendMenuW(hmenu, flags, submenu, ptr(labelBuffer));
        continue;
      }
      const commandId = nextCommandId;
      nextCommandId += 1;
      // A role's behavior is native (no JS click); a plain item fires its onClick.
      if (item.role === undefined && item.onClick !== undefined) {
        callbackByCommandId.set(commandId, item.onClick);
      }
      user32.AppendMenuW(
        hmenu,
        menuItemFlags(item.enabled, item.checked ?? false),
        BigInt(commandId),
        ptr(labelBuffer),
      );
    }
    return hmenu;
  };

  return {
    realize(items: ReadonlyArray<NativeMenuItemSpec>): bigint {
      return buildMenu(items);
    },

    setApplicationMenu(_menu: bigint): void {
      // No global menu bar on Windows (it is per-window via SetMenu); deferred.
    },

    dispatchMenuCommand(commandId: number): void {
      callbackByCommandId.get(commandId)?.();
    },
  };
};

/** The process-wide Windows menu realizer (the window dispatches commands into it). */
export const windowsMenuRealizer = createWindowsMenuRealizer();

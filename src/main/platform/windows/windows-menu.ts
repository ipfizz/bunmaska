import { ptr } from 'bun:ffi';
import type { MenuRealizer } from '../../api/menu';
import type { NativeMenuItemSpec } from '../macos/cocoa-menu';
import { wstr } from './win32';
import { loadUser32 } from './win32-ffi';

/**
 * Windows has no global menu, so `setApplicationMenu` installs a per-window menu BAR,
 * built with `CreateMenu` (vs `CreatePopupMenu` for context menus); a fresh HMENU is built
 * PER window, because an HMENU can only belong to one window. Menu clicks reach us as
 * `WM_COMMAND` on the window's JSCallback frame proc.
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

/** A window that can carry the application menu bar (its native `setMenuBar`). */
export type AppMenuWindow = {
  /** Attach an HMENU bar, or remove it with `null`. The window owns the HMENU. */
  setMenuBar(menuBar: bigint | null): void;
};

/** The Windows realizer plus the command dispatch the window calls after a popup. */
export type WindowsMenuRealizer = MenuRealizer & {
  /** Fire the `onClick` stored for `commandId` (a `TrackPopupMenu`/`WM_COMMAND` result). */
  dispatchMenuCommand(commandId: number): void;
  /** Start mirroring the application menu onto `window` (and apply it if one is set). */
  registerAppMenuWindow(window: AppMenuWindow): void;
  /** Stop mirroring the application menu onto `window` (on window close). */
  unregisterAppMenuWindow(window: AppMenuWindow): void;
};

/**
 * Build a Windows menu realizer. A factory (not just a singleton) so tests get an
 * isolated command-id space; production uses {@link windowsMenuRealizer}.
 */
export const createWindowsMenuRealizer = (): WindowsMenuRealizer => {
  const callbackByCommandId = new Map<number, () => void>();
  let nextCommandId = 1;
  // Windows mirroring the application menu, the current app-menu spec, and the
  // last realize() result (menu.ts calls realize() then setApplicationMenu(handle)
  // back-to-back, so a single slot recovers the spec from the handle leak-free).
  const appMenuWindows = new Set<AppMenuWindow>();
  let appMenuItems: ReadonlyArray<NativeMenuItemSpec> | null = null;
  let lastRealized: { handle: bigint; items: ReadonlyArray<NativeMenuItemSpec> } | undefined;

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

  /** Build a menu BAR (CreateMenu container) from top-level items. Each is a popup
   *  (submenu) or a clickable bar item; separators are skipped (meaningless in a bar). */
  const buildMenuBar = (items: ReadonlyArray<NativeMenuItemSpec>): bigint => {
    const user32 = loadUser32().symbols;
    const bar = user32.CreateMenu();
    for (const item of items) {
      if (item.type === 'separator') {
        continue;
      }
      const labelBuffer = wstr(item.label); // copied by AppendMenuW; alive across the call
      if (item.type === 'submenu' && item.submenu !== undefined) {
        const submenu = buildMenu(item.submenu);
        const flags = MF_POPUP | MF_STRING | (item.enabled ? 0 : MF_GRAYED);
        user32.AppendMenuW(bar, flags, submenu, ptr(labelBuffer));
        continue;
      }
      const commandId = nextCommandId;
      nextCommandId += 1;
      if (item.role === undefined && item.onClick !== undefined) {
        callbackByCommandId.set(commandId, item.onClick);
      }
      user32.AppendMenuW(
        bar,
        menuItemFlags(item.enabled, item.checked ?? false),
        BigInt(commandId),
        ptr(labelBuffer),
      );
    }
    return bar;
  };

  return {
    realize(items: ReadonlyArray<NativeMenuItemSpec>): bigint {
      const handle = buildMenu(items);
      lastRealized = { handle, items };
      return handle;
    },

    setApplicationMenu(menu: bigint): void {
      // Recover the spec from the handle realize() just produced, so a FRESH bar
      // (one HMENU per window) can be built for every window.
      const items = lastRealized?.handle === menu ? lastRealized.items : appMenuItems;
      appMenuItems = items ?? null;
      for (const window of appMenuWindows) {
        window.setMenuBar(items !== null && items !== undefined ? buildMenuBar(items) : null);
      }
    },

    registerAppMenuWindow(window: AppMenuWindow): void {
      appMenuWindows.add(window);
      if (appMenuItems !== null) {
        window.setMenuBar(buildMenuBar(appMenuItems));
      }
    },

    unregisterAppMenuWindow(window: AppMenuWindow): void {
      appMenuWindows.delete(window);
    },

    dispatchMenuCommand(commandId: number): void {
      callbackByCommandId.get(commandId)?.();
    },
  };
};

/** The process-wide Windows menu realizer (the window dispatches commands into it). */
export const windowsMenuRealizer = createWindowsMenuRealizer();

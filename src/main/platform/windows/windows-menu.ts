import { ptr } from 'bun:ffi';
import { FFIError } from '../../../common/errors';
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

/** `WM_COMMAND` carries the id in LOWORD(wParam), so ids live in 1..0xFFFF. */
const MAX_COMMAND_ID = 0xffff;

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

/** The user32 calls the realizer makes. */
type MenuApi = Pick<
  ReturnType<typeof loadUser32>['symbols'],
  'CreateMenu' | 'CreatePopupMenu' | 'AppendMenuW' | 'DestroyMenu'
>;

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

export const createWindowsMenuRealizer = (
  user32: () => MenuApi = () => loadUser32().symbols,
): WindowsMenuRealizer => {
  // Every id on a menu that may still be shown, with its JS click (undefined for a role).
  const commands = new Map<number, (() => void) | undefined>();
  let lastCommandId = 0;
  const barIds = new Map<AppMenuWindow, number[]>();
  let appMenuItems: ReadonlyArray<NativeMenuItemSpec> | null = null;
  // menu.ts consumes each realize() result before the next one (a popup is destroyed
  // once TrackPopupMenu returns; setApplicationMenu reads it at once), so one slot
  // recovers the spec from the handle and frees the previous result's ids.
  let lastRealized:
    | { handle: bigint; items: ReadonlyArray<NativeMenuItemSpec>; ids: number[] }
    | undefined;

  const allocateId = (onClick: (() => void) | undefined): number => {
    for (let tries = 0; tries < MAX_COMMAND_ID; tries += 1) {
      lastCommandId = (lastCommandId % MAX_COMMAND_ID) + 1;
      if (!commands.has(lastCommandId)) {
        commands.set(lastCommandId, onClick);
        return lastCommandId;
      }
    }
    throw new FFIError('menu: all 65535 command ids are in use');
  };

  const release = (ids: ReadonlyArray<number>): void => {
    for (const id of ids) {
      commands.delete(id);
    }
  };

  /** Build a menu bar (`CreateMenu`, no separators) or a popup; `ids` collects its command ids. */
  const build = (items: ReadonlyArray<NativeMenuItemSpec>, bar: boolean, ids: number[]): bigint => {
    const api = user32();
    const hmenu = bar ? api.CreateMenu() : api.CreatePopupMenu();
    for (const item of items) {
      if (item.type === 'separator') {
        if (!bar) {
          api.AppendMenuW(hmenu, MF_SEPARATOR, 0n, null);
        }
        continue;
      }
      const labelBuffer = wstr(item.label); // AppendMenuW copies the label
      if (item.type === 'submenu' && item.submenu !== undefined) {
        const flags = MF_POPUP | MF_STRING | (item.enabled ? 0 : MF_GRAYED);
        api.AppendMenuW(hmenu, flags, build(item.submenu, false, ids), ptr(labelBuffer));
        continue;
      }
      // ponytail: roles are inert on Windows (no dispatch or accelerator table).
      const id = allocateId(item.role === undefined ? item.onClick : undefined);
      ids.push(id);
      api.AppendMenuW(
        hmenu,
        menuItemFlags(item.enabled, item.checked ?? false),
        BigInt(id),
        ptr(labelBuffer),
      );
    }
    return hmenu;
  };

  const installBar = (window: AppMenuWindow): void => {
    release(barIds.get(window) ?? []);
    const ids: number[] = [];
    barIds.set(window, ids);
    window.setMenuBar(appMenuItems === null ? null : build(appMenuItems, true, ids));
  };

  return {
    realize(items: ReadonlyArray<NativeMenuItemSpec>): bigint {
      release(lastRealized?.ids ?? []);
      const ids: number[] = [];
      const handle = build(items, false, ids);
      lastRealized = { handle, items, ids };
      return handle;
    },

    setApplicationMenu(menu: bigint | null): void {
      if (menu === null) {
        appMenuItems = null;
      } else if (lastRealized?.handle === menu) {
        // Each window gets its own bar, so the realized popup tree is only a key to its items.
        appMenuItems = lastRealized.items;
        release(lastRealized.ids);
        user32().DestroyMenu(menu);
        lastRealized = undefined;
      }
      for (const window of barIds.keys()) {
        installBar(window);
      }
    },

    registerAppMenuWindow(window: AppMenuWindow): void {
      barIds.set(window, []);
      if (appMenuItems !== null) {
        installBar(window);
      }
    },

    unregisterAppMenuWindow(window: AppMenuWindow): void {
      release(barIds.get(window) ?? []);
      barIds.delete(window);
    },

    dispatchMenuCommand(commandId: number): void {
      commands.get(commandId)?.();
    },
  };
};

/** The process-wide Windows menu realizer (the window dispatches commands into it). */
export const windowsMenuRealizer = createWindowsMenuRealizer();

import { ptr } from 'bun:ffi';
import { FFIError } from '../../../common/errors';
import type { MenuRealizer, MenuWindowAction } from '../../api/menu';
import type { NativeMenuItemSpec } from '../macos/cocoa-menu';
import { wstr } from './win32';
import { loadUser32 } from './win32-ffi';

// The application menu is a bar per window (an HMENU belongs to one window); bar clicks
// arrive as WM_COMMAND on the window's JSCallback frame proc (D043).

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
  /** Run a window role (minimize, close, zoom, togglefullscreen) on this window. */
  performWindowAction(action: MenuWindowAction): void;
};

/** The Windows realizer plus the command dispatch the window calls after a popup. */
export type WindowsMenuRealizer = MenuRealizer & {
  /** Run the item stored for `commandId` (a `TrackPopupMenu`/`WM_COMMAND` result) on `window`. */
  dispatchMenuCommand(commandId: number, window: AppMenuWindow): void;
  /** Start mirroring the application menu onto `window` (and apply it if one is set). */
  registerAppMenuWindow(window: AppMenuWindow): void;
  /** Stop mirroring the application menu onto `window` (on window close). */
  unregisterAppMenuWindow(window: AppMenuWindow): void;
};

type Command = (window: AppMenuWindow) => void;

/** A role wins over a click (D035); quit has no native command, so it keeps its click. */
const commandFor = ({ onClick, role, windowAction }: NativeMenuItemSpec): Command | undefined => {
  if (windowAction !== undefined) {
    return (window) => window.performWindowAction(windowAction);
  }
  // ponytail: editing roles are inert; WinCairo's C API has no editing-command call
  return role === undefined || role === 'quit' ? onClick : undefined;
};

export const createWindowsMenuRealizer = (
  user32: () => MenuApi = () => loadUser32().symbols,
): WindowsMenuRealizer => {
  // Every id on a menu that may still be shown, with what it runs (undefined for an inert role).
  const commands = new Map<number, Command | undefined>();
  let lastCommandId = 0;
  const barIds = new Map<AppMenuWindow, number[]>();
  let appMenuItems: ReadonlyArray<NativeMenuItemSpec> | null = null;
  // menu.ts consumes each realize() result before the next one (a popup is destroyed
  // once TrackPopupMenu returns; setApplicationMenu reads it at once), so one slot
  // recovers the spec from the handle and frees the previous result's ids.
  let lastRealized:
    | { handle: bigint; items: ReadonlyArray<NativeMenuItemSpec>; ids: number[] }
    | undefined;

  const allocateId = (command: Command | undefined): number => {
    for (let tries = 0; tries < MAX_COMMAND_ID; tries += 1) {
      lastCommandId = (lastCommandId % MAX_COMMAND_ID) + 1;
      if (!commands.has(lastCommandId)) {
        commands.set(lastCommandId, command);
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
      const id = allocateId(commandFor(item));
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

    dispatchMenuCommand(commandId: number, window: AppMenuWindow): void {
      commands.get(commandId)?.(window);
    },
  };
};

/** The process-wide Windows menu realizer (the window dispatches commands into it). */
export const windowsMenuRealizer = createWindowsMenuRealizer();

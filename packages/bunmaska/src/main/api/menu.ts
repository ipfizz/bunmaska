import { InvalidArgumentError, BunmaskaError, UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import type { BrowserWindow } from './browser-window';
import { linuxMenuRealizer } from '../platform/linux/gtk-menu';
import type { NativeMenuItemSpec } from '../platform/macos/cocoa-menu';
import * as cocoaMenu from '../platform/macos/cocoa-menu';

/**
 * Application and context menus — the drop-in equivalent of Electron's `Menu` /
 * `MenuItem`.
 *
 * The classes hold the menu tree in plain JS; turning it into native `NSMenu`
 * objects is delegated to an injectable realizer (defaulting to the macOS
 * backend) so the tree logic is unit-testable without any FFI, and Linux can
 * supply its own realizer later.
 */

export type MenuItemType = 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';

/**
 * A predefined item role (Electron's `MenuItem.role`). A role gives the item a
 * default label + accelerator + native behavior with no explicit `click`. On
 * macOS each role maps to a standard first-responder selector, routed up the
 * responder chain to the focused web view / window / app (exactly like the
 * native shortcut). Linux wiring (per-window editing commands) is a follow-up —
 * role items render as labels there today, and their keyboard shortcuts work
 * natively via WebKit.
 */
export type MenuRole =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'pasteAndMatchStyle'
  | 'delete'
  | 'selectAll'
  | 'minimize'
  | 'close'
  | 'zoom'
  | 'quit'
  | 'togglefullscreen'
  | 'about'
  | 'hide'
  | 'hideOthers'
  | 'unhide';

/**
 * A "macro" role that expands to a whole standard submenu (Electron's
 * `editMenu`/`windowMenu`). `appMenu`/`viewMenu` are deferred — `appMenu` needs
 * the app name (a menu→app import cycle) and `viewMenu` needs reload/zoom/
 * devtools menu roles Bunmaska doesn't expose yet.
 */
export type MenuMacroRole = 'editMenu' | 'windowMenu';

export type MenuItemOptions = {
  readonly label?: string;
  readonly type?: MenuItemType;
  /** A stable id for {@link Menu.getMenuItemById}. */
  readonly id?: string;
  readonly enabled?: boolean;
  /** Whether a `checkbox`/`radio` item is checked (renders a checkmark). */
  readonly checked?: boolean;
  /** A single-key accelerator like `'CmdOrCtrl+Q'`. */
  readonly accelerator?: string;
  /** A predefined role (item-level) or a macro role that expands to a submenu. */
  readonly role?: MenuRole | MenuMacroRole;
  readonly click?: () => void;
  readonly submenu?: Menu | ReadonlyArray<MenuItemOptions>;
};

/** A Linux GTK window action a role maps to (operated on the activating window). */
export type MenuWindowAction = 'minimize' | 'close' | 'zoom' | 'togglefullscreen';

/**
 * Per-role defaults: label, accelerator, the macOS first-responder selector, and the Linux
 * dispatch — `editingCommand` (a WebKitGTK editing command run on the focused web view) or
 * `windowAction` (a GTK window op). Roles with neither (quit/about/hide/…) have no Linux
 * menu-click wiring yet (their keyboard shortcuts still work natively); macOS wires them all.
 */
const ROLE_DEFAULTS: Record<
  MenuRole,
  {
    label: string;
    accelerator?: string;
    macSelector: string;
    editingCommand?: string;
    windowAction?: MenuWindowAction;
  }
> = {
  undo: {
    label: 'Undo',
    accelerator: 'CommandOrControl+Z',
    macSelector: 'undo:',
    editingCommand: 'Undo',
  },
  redo: {
    label: 'Redo',
    accelerator: 'Shift+CommandOrControl+Z',
    macSelector: 'redo:',
    editingCommand: 'Redo',
  },
  cut: {
    label: 'Cut',
    accelerator: 'CommandOrControl+X',
    macSelector: 'cut:',
    editingCommand: 'Cut',
  },
  copy: {
    label: 'Copy',
    accelerator: 'CommandOrControl+C',
    macSelector: 'copy:',
    editingCommand: 'Copy',
  },
  paste: {
    label: 'Paste',
    accelerator: 'CommandOrControl+V',
    macSelector: 'paste:',
    editingCommand: 'Paste',
  },
  pasteAndMatchStyle: {
    label: 'Paste and Match Style',
    accelerator: 'Option+Shift+CommandOrControl+V',
    macSelector: 'pasteAndMatchStyle:',
    editingCommand: 'PasteAsPlainText',
  },
  delete: { label: 'Delete', macSelector: 'delete:', editingCommand: 'Delete' },
  selectAll: {
    label: 'Select All',
    accelerator: 'CommandOrControl+A',
    macSelector: 'selectAll:',
    editingCommand: 'SelectAll',
  },
  minimize: {
    label: 'Minimize',
    accelerator: 'CommandOrControl+M',
    macSelector: 'performMiniaturize:',
    windowAction: 'minimize',
  },
  close: {
    label: 'Close Window',
    accelerator: 'CommandOrControl+W',
    macSelector: 'performClose:',
    windowAction: 'close',
  },
  zoom: { label: 'Zoom', macSelector: 'performZoom:', windowAction: 'zoom' },
  quit: { label: 'Quit', accelerator: 'CommandOrControl+Q', macSelector: 'terminate:' },
  togglefullscreen: {
    label: 'Toggle Full Screen',
    accelerator: 'Control+Command+F',
    macSelector: 'toggleFullScreen:',
    windowAction: 'togglefullscreen',
  },
  about: { label: 'About', macSelector: 'orderFrontStandardAboutPanel:' },
  hide: { label: 'Hide', accelerator: 'Command+H', macSelector: 'hide:' },
  hideOthers: {
    label: 'Hide Others',
    accelerator: 'Command+Alt+H',
    macSelector: 'hideOtherApplications:',
  },
  unhide: { label: 'Show All', macSelector: 'unhideAllApplications:' },
};

/** Standard submenu each macro role expands into (Electron's defaults, minus deferred items). */
const MACRO_ROLE_SUBMENUS: Record<
  MenuMacroRole,
  { readonly label: string; readonly submenu: ReadonlyArray<MenuItemOptions> }
> = {
  editMenu: {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
    ],
  },
  windowMenu: {
    label: 'Window',
    submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'close' }],
  },
};

const isMacroRole = (role: MenuRole | MenuMacroRole): role is MenuMacroRole =>
  role === 'editMenu' || role === 'windowMenu';

/** Extract the bare key character from an accelerator string (e.g. `'CmdOrCtrl+Q'` → `'q'`). */
const acceleratorKey = (accelerator: string | undefined): string => {
  if (accelerator === undefined || accelerator.length === 0) {
    return '';
  }
  const parts = accelerator.split('+');
  const key = parts[parts.length - 1] ?? '';
  return key.length === 1 ? key.toLowerCase() : '';
};

// NSEventModifierFlags bits (macOS): only the modifier portion matters here.
const NS_SHIFT = 1n << 17n;
const NS_CONTROL = 1n << 18n;
const NS_OPTION = 1n << 19n;
const NS_COMMAND = 1n << 20n;

/**
 * Parse the modifier portion of an accelerator into an `NSEventModifierFlags`
 * mask (macOS). `CommandOrControl` maps to Command on macOS. Returns `0n` for no
 * accelerator. Without this, AppKit assumes Command-only and multi-modifier
 * accelerators (e.g. redo's `Shift+Cmd+Z`) collapse and collide.
 */
const acceleratorModifierMask = (accelerator: string | undefined): bigint => {
  if (accelerator === undefined || accelerator.length === 0) {
    return 0n;
  }
  let mask = 0n;
  for (const raw of accelerator.split('+')) {
    switch (raw.toLowerCase()) {
      case 'shift':
        mask |= NS_SHIFT;
        break;
      case 'control':
      case 'ctrl':
        mask |= NS_CONTROL;
        break;
      case 'alt':
      case 'option':
        mask |= NS_OPTION;
        break;
      case 'command':
      case 'cmd':
      case 'meta':
      case 'super':
      case 'commandorcontrol':
      case 'cmdorctrl':
        mask |= NS_COMMAND;
        break;
    }
  }
  return mask;
};

export class MenuItem {
  readonly label: string;
  readonly type: MenuItemType;
  readonly id: string | undefined;
  readonly enabled: boolean;
  readonly checked: boolean;
  readonly accelerator: string | undefined;
  readonly role: MenuRole | undefined;
  readonly click: (() => void) | undefined;
  readonly submenu: Menu | undefined;

  constructor(options: MenuItemOptions) {
    this.id = options.id;
    const role = options.role;
    if (role !== undefined && isMacroRole(role)) {
      // A macro role expands into a labeled submenu of standard role items.
      const macro = MACRO_ROLE_SUBMENUS[role];
      this.role = undefined;
      this.label = options.label ?? macro.label;
      this.enabled = options.enabled ?? true;
      this.checked = false;
      this.accelerator = undefined;
      this.click = undefined;
      this.submenu = Menu.buildFromTemplate(macro.submenu);
      this.type = 'submenu';
      return;
    }
    this.role = role;
    const roleDefault = role !== undefined ? ROLE_DEFAULTS[role] : undefined;
    // App-supplied label/accelerator win over the role's defaults.
    this.label = options.label ?? roleDefault?.label ?? '';
    this.enabled = options.enabled ?? true;
    this.checked = options.checked ?? false;
    this.accelerator = options.accelerator ?? roleDefault?.accelerator;
    this.click = options.click;
    this.submenu =
      options.submenu === undefined
        ? undefined
        : options.submenu instanceof Menu
          ? options.submenu
          : Menu.buildFromTemplate(options.submenu);
    this.type = options.type ?? (this.submenu !== undefined ? 'submenu' : 'normal');
  }
}

/** Realizes a spec tree into a native menu handle (bigint) and installs it. */
export type MenuRealizer = {
  realize(items: ReadonlyArray<NativeMenuItemSpec>): bigint;
  setApplicationMenu(menu: bigint): void;
};

const macosRealizer: MenuRealizer = {
  realize: (items) => cocoaMenu.realizeMenu(items),
  setApplicationMenu: (menu) => cocoaMenu.setApplicationMenu(menu),
};

let realizer: MenuRealizer | undefined;

const getRealizer = (): MenuRealizer => {
  if (realizer !== undefined) {
    return realizer;
  }
  if (currentPlatform() === 'macos') {
    return macosRealizer;
  }
  if (currentPlatform() === 'linux') {
    return linuxMenuRealizer;
  }
  throw new UnsupportedPlatformError(`Menu is not supported on ${currentPlatform()} yet`);
};

/** Override the native realizer. Test-only. */
export const setMenuRealizerForTesting = (fake: MenuRealizer | undefined): void => {
  realizer = fake;
};

const toSpec = (item: MenuItem): NativeMenuItemSpec => {
  const mask = acceleratorModifierMask(item.accelerator);
  const base = {
    label: item.label,
    type: item.type,
    enabled: item.enabled,
    checked: item.checked,
    keyEquivalent: acceleratorKey(item.accelerator),
    ...(mask !== 0n ? { modifierMask: mask } : {}),
    ...(item.role !== undefined
      ? {
          role: item.role,
          roleSelector: ROLE_DEFAULTS[item.role].macSelector,
          // Linux dispatch (one or neither): a WebKitGTK editing command or a GTK window op.
          ...(ROLE_DEFAULTS[item.role].editingCommand !== undefined
            ? { editingCommand: ROLE_DEFAULTS[item.role].editingCommand }
            : {}),
          ...(ROLE_DEFAULTS[item.role].windowAction !== undefined
            ? { windowAction: ROLE_DEFAULTS[item.role].windowAction }
            : {}),
        }
      : {}),
  };
  if (item.type === 'submenu' && item.submenu !== undefined) {
    return { ...base, submenu: item.submenu.items.map(toSpec) };
  }
  // A role provides native behavior via its selector (macOS) — no JS click is
  // synthesized; if both a role and a click are given, the role takes precedence.
  const clickable = item.type === 'normal' || item.type === 'checkbox' || item.type === 'radio';
  if (item.role === undefined && clickable && item.click !== undefined) {
    return { ...base, onClick: item.click };
  }
  return base;
};

/** Options for {@link Menu.popup} (Electron's `PopupOptions`). */
export type MenuPopupOptions = {
  /** Window to anchor the popup to. Defaults to the focused, else most-recent, window. */
  readonly window?: BrowserWindow;
  /** X coordinate (content-relative). Defaults to 0 in v1 (NOT the mouse position). */
  readonly x?: number;
  /** Y coordinate (content-relative). Defaults to 0 in v1 (NOT the mouse position). */
  readonly y?: number;
};

/** The popup-capable subset of a native window the menu seam drives. */
export type PopupTarget = {
  popupMenu(menuHandle: bigint, x: number, y: number): void;
  closePopupMenu(): void;
};

/**
 * How {@link Menu.popup} finds its target window. Injected by the BrowserWindow module at
 * load (which alone can see the window registry), so `menu.ts` needs no runtime import of
 * `browser-window` — avoiding an import cycle. Replaceable for tests.
 */
export type WindowResolver = {
  /** The focused window's popup target, or undefined. */
  focused(): PopupTarget | undefined;
  /** The most-recently-created window's popup target, or undefined. */
  mostRecent(): PopupTarget | undefined;
  /** Resolve an explicit window object to its popup target, or undefined if not a known window. */
  resolve(window: unknown): PopupTarget | undefined;
};

let windowResolver: WindowResolver | undefined;

/** Wire the window resolver. Called once at bootstrap by the BrowserWindow module. */
export const installWindowResolver = (resolver: WindowResolver): void => {
  windowResolver = resolver;
};

/** Override the window resolver. Test-only. */
export const setWindowResolverForTesting = (fake: WindowResolver | undefined): void => {
  windowResolver = fake;
};

/** Resolve the popup target per the v1 policy (explicit → focused → most-recent → throw). @internal */
export const resolvePopupTarget = (
  options: MenuPopupOptions | undefined,
  resolver: WindowResolver,
): PopupTarget => {
  if (options?.window !== undefined) {
    const target = resolver.resolve(options.window);
    if (target === undefined) {
      throw new InvalidArgumentError('Menu.popup: the given window is not an open BrowserWindow');
    }
    return target;
  }
  const target = resolver.focused() ?? resolver.mostRecent();
  if (target === undefined) {
    throw new InvalidArgumentError(
      'Menu.popup: no window option and no open window to anchor the popup',
    );
  }
  return target;
};

export class Menu {
  /** The items in this menu, in order. */
  readonly items: MenuItem[] = [];
  #popupTarget: PopupTarget | undefined;

  /** Append an item to the end of the menu. */
  append(item: MenuItem): void {
    this.items.push(item);
  }

  /** Insert `item` at position `pos` (clamped to the menu's bounds). */
  insert(pos: number, item: MenuItem): void {
    this.items.splice(Math.max(0, Math.min(pos, this.items.length)), 0, item);
  }

  /** Find an item by its `id`, searching submenus depth-first; `null` if not found. */
  getMenuItemById(id: string): MenuItem | null {
    for (const item of this.items) {
      if (item.id === id) {
        return item;
      }
      const nested = item.submenu?.getMenuItemById(id);
      if (nested != null) {
        return nested;
      }
    }
    return null;
  }

  /** Build a menu from a template of plain option objects. */
  static buildFromTemplate(template: ReadonlyArray<MenuItemOptions | MenuItem>): Menu {
    const menu = new Menu();
    for (const entry of template) {
      menu.append(entry instanceof MenuItem ? entry : new MenuItem(entry));
    }
    return menu;
  }

  /** Realize this menu to a native handle. @internal */
  realize(): bigint {
    return getRealizer().realize(this.items.map(toSpec));
  }

  /** Set `menu` as the application menu bar, or clear it with `null`. */
  static setApplicationMenu(menu: Menu | null): void {
    applicationMenu = menu;
    if (menu !== null) {
      getRealizer().setApplicationMenu(menu.realize());
    }
  }

  /** The current application menu, or `null` if none is set. */
  static getApplicationMenu(): Menu | null {
    return applicationMenu;
  }

  /**
   * Show this menu as a context/popup menu — Electron's `menu.popup({ window?, x?, y? })`.
   * Realizes the menu and shows it anchored to the target window (the `window` option, else
   * the focused window, else the most-recently-created window). `x`/`y` are content-relative
   * and default to the top-left in v1 (not the mouse position).
   *
   * macOS BLOCKS (AppKit runs a nested tracking loop until dismissed — the same nested-loop
   * class as a modal dialog's `runModal`, D020-safe); Linux is non-blocking.
   */
  popup(options?: MenuPopupOptions): void {
    if (windowResolver === undefined) {
      throw new BunmaskaError('Menu.popup is unavailable: no window backend installed');
    }
    const target = resolvePopupTarget(options, windowResolver);
    this.#popupTarget = target;
    target.popupMenu(this.realize(), options?.x ?? 0, options?.y ?? 0);
  }

  /**
   * Close this popup menu — Electron's `menu.closePopup(window?)`. macOS cancels menu
   * tracking (meaningful only re-entrantly, e.g. from an item's own click, since `popup`
   * blocks until dismissal); Linux pops the popover down.
   */
  closePopup(window?: BrowserWindow): void {
    const target =
      window !== undefined
        ? windowResolver?.resolve(window)
        : (this.#popupTarget ?? windowResolver?.focused());
    target?.closePopupMenu();
  }
}

let applicationMenu: Menu | null = null;

/** Reset the stored application menu. Test-only. */
export const resetApplicationMenuForTesting = (): void => {
  applicationMenu = null;
};

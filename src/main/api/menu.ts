import { BunmaskaError, InvalidArgumentError, UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import { linuxMenuRealizer } from '../platform/linux/gtk-menu';
import { parseAccelerator } from './accelerator';
import * as cocoaMenu from '../platform/macos/cocoa-menu';
import { windowsMenuRealizer } from '../platform/windows/windows-menu';
import type { MenuRealizer, MenuWindowAction, NativeMenuItemSpec } from '../platform/services';
import type { BrowserWindow } from './browser-window';

export type MenuItemType = 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';

/** Electron's `MenuItem.role`: a default label, accelerator and native action (D035, D039). */
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

/** A role that expands into a standard submenu. */
export type MenuMacroRole = 'editMenu' | 'windowMenu'; // ponytail: no appMenu/fileMenu/viewMenu; unknown roles degrade to plain items

export type MenuItemOptions = {
  readonly label?: string;
  readonly type?: MenuItemType;
  /** A stable id for {@link Menu.getMenuItemById}. */
  readonly id?: string;
  readonly enabled?: boolean;
  /** Only meaningful for `checkbox`/`radio`. */
  readonly checked?: boolean;
  /** e.g. `'CmdOrCtrl+Q'`. macOS only: Linux and Windows neither bind nor show it. */
  readonly accelerator?: string; // ponytail: Linux GtkShortcutController, Windows accelerator table
  readonly role?: MenuRole | MenuMacroRole;
  readonly click?: MenuItemClick;
  readonly submenu?: Menu | ReadonlyArray<MenuItemOptions>;
};

/** Electron's signature; `event` fields are omitted when unknown. */
export type MenuItemClick = (
  menuItem: MenuItem,
  window: BrowserWindow | undefined,
  event: { readonly triggeredByAccelerator?: boolean },
) => void;

/**
 * `macSelector` drives macOS (D035); `editingCommand` or `windowAction` drive Linux
 * (D039); Windows runs only `windowAction`, its editing roles are inert.
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

/** Electron's defaults, minus the deferred items. */
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

const isMacroRole = (role: string): role is MenuMacroRole =>
  Object.hasOwn(MACRO_ROLE_SUBMENUS, role);

const isRole = (role: string): role is MenuRole => Object.hasOwn(ROLE_DEFAULTS, role);

/** Electron matches roles case-insensitively. */
const ROLE_NAMES = new Map(
  [...Object.keys(ROLE_DEFAULTS), ...Object.keys(MACRO_ROLE_SUBMENUS)].map((r) => [
    r.toLowerCase(),
    r,
  ]),
);

/** AppKit key equivalents for named keys; `\uf7xx` are NSEvent.h's function-key unicodes. */
const MAC_NAMED_KEYS = new Map([
  ['Plus', '+'],
  ['Space', ' '],
  ['Tab', '\t'],
  ['Return', '\r'],
  ['Escape', '\u001b'],
  ['Backspace', '\b'],
  ['Insert', '\uf727'],
  ['Delete', '\uf728'],
  ['Up', '\uf700'],
  ['Down', '\uf701'],
  ['Left', '\uf702'],
  ['Right', '\uf703'],
  ['Home', '\uf729'],
  ['End', '\uf72b'],
  ['PageUp', '\uf72c'],
  ['PageDown', '\uf72d'],
]);

/** `'CmdOrCtrl+Q'` is `'q'`; `''` when AppKit has no key equivalent for the key. */
const acceleratorKey = (accelerator: string | undefined): string => {
  const key = accelerator ? parseAccelerator(accelerator, 'macos')?.key : undefined;
  if (key === undefined) {
    return '';
  }
  if (key.length === 1) {
    return key.toLowerCase();
  }
  if (/^F\d+$/.test(key)) {
    return String.fromCharCode(0xf704 + Number(key.slice(1)) - 1); // NSF1FunctionKey + n - 1
  }
  return MAC_NAMED_KEYS.get(key) ?? '';
};

// NSEventModifierFlags modifier bits.
const NS_SHIFT = 1n << 17n;
const NS_CONTROL = 1n << 18n;
const NS_OPTION = 1n << 19n;
const NS_COMMAND = 1n << 20n;

/**
 * The accelerator's modifiers as `NSEventModifierFlags`. Without it AppKit assumes
 * Command only, so redo's `Shift+Cmd+Z` collapses onto undo (D035).
 */
const acceleratorModifierMask = (accelerator: string | undefined): bigint => {
  const parsed = accelerator ? parseAccelerator(accelerator, 'macos') : undefined;
  if (parsed === undefined) {
    return 0n;
  }
  return (
    (parsed.shift ? NS_SHIFT : 0n) |
    (parsed.ctrl ? NS_CONTROL : 0n) |
    (parsed.alt ? NS_OPTION : 0n) |
    (parsed.meta || parsed.super ? NS_COMMAND : 0n)
  );
};

export class MenuItem {
  readonly label: string;
  readonly type: MenuItemType;
  readonly id: string | undefined;
  readonly enabled: boolean;
  checked: boolean;
  readonly accelerator: string | undefined;
  readonly role: MenuRole | undefined;
  readonly click: MenuItemClick | undefined;
  readonly submenu: Menu | undefined;

  constructor(options: MenuItemOptions) {
    this.id = options.id;
    const role =
      options.role === undefined ? undefined : ROLE_NAMES.get(options.role.toLowerCase());
    const macro = role !== undefined && isMacroRole(role) ? MACRO_ROLE_SUBMENUS[role] : undefined;
    // An unsupported role degrades to a plain item labelled with the role name.
    this.role = role !== undefined && isRole(role) ? role : undefined;
    const roleDefault = this.role !== undefined ? ROLE_DEFAULTS[this.role] : undefined;
    this.label = options.label ?? macro?.label ?? roleDefault?.label ?? options.role ?? '';
    this.enabled = options.enabled ?? true;
    this.checked = options.checked ?? false;
    this.accelerator = options.accelerator ?? roleDefault?.accelerator;
    this.click = options.click;
    const submenu = options.submenu ?? macro?.submenu;
    this.submenu =
      submenu === undefined || submenu instanceof Menu ? submenu : Menu.buildFromTemplate(submenu);
    this.type = options.type ?? (this.submenu !== undefined ? 'submenu' : 'normal');
  }
}

const macosRealizer: MenuRealizer = {
  realize: (items) => cocoaMenu.realizeMenu(items),
  setApplicationMenu: (menu) => cocoaMenu.setApplicationMenu(menu ?? 0n),
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
  if (currentPlatform() === 'windows') {
    return windowsMenuRealizer;
  }
  throw new UnsupportedPlatformError(`Menu is not supported on ${currentPlatform()} yet`);
};

/** @internal */
export const setMenuRealizerForTesting = (fake: MenuRealizer | undefined): void => {
  realizer = fake;
};

/** Electron groups radio items by the separators around them. */
const radioGroup = (item: MenuItem, siblings: readonly MenuItem[]): MenuItem[] => {
  let start = siblings.indexOf(item);
  while (start > 0 && siblings[start - 1]?.type !== 'separator') {
    start -= 1;
  }
  let end = start;
  while (end < siblings.length - 1 && siblings[end + 1]?.type !== 'separator') {
    end += 1;
  }
  return siblings.slice(start, end + 1).filter((other) => other.type === 'radio');
};

/** Electron's click: a checkbox flips, a radio checks itself in its group, then `click` runs. */
const activate = (item: MenuItem, siblings: readonly MenuItem[]): void => {
  if (item.type === 'checkbox') {
    item.checked = !item.checked;
  } else if (item.type === 'radio') {
    for (const other of radioGroup(item, siblings)) {
      other.checked = other === item;
    }
  }
  // ponytail: Linux/Windows menu bars show the old check mark until the next setApplicationMenu; re-realize them here
  item.click?.(item, windowResolver?.focusedWindow(), {});
};

const toSpecs = (items: readonly MenuItem[]): NativeMenuItemSpec[] =>
  items.map((item) => toSpec(item, items));

const toSpec = (item: MenuItem, siblings: readonly MenuItem[]): NativeMenuItemSpec => {
  const keyEquivalent = acceleratorKey(item.accelerator);
  const base = {
    label: item.label,
    type: item.type,
    enabled: item.enabled,
    checked: item.checked,
    keyEquivalent,
    // Always explicit: an absent mask makes AppKit assume Command, so `F11` would need Cmd.
    ...(keyEquivalent !== '' ? { modifierMask: acceleratorModifierMask(item.accelerator) } : {}),
    ...(item.role !== undefined
      ? {
          role: item.role,
          roleSelector: ROLE_DEFAULTS[item.role].macSelector,
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
    return { ...base, submenu: toSpecs(item.submenu.items) };
  }
  // macOS routes terminate: through the app delegate; elsewhere the quit role has no native command.
  if (item.role === 'quit') {
    return { ...base, onClick: () => quitHandler?.() };
  }
  // A role wins over a click: one native item cannot run both (D035).
  const checkable = item.type === 'checkbox' || item.type === 'radio';
  if (
    item.role === undefined &&
    (checkable || (item.type === 'normal' && item.click !== undefined))
  ) {
    return { ...base, onClick: () => activate(item, siblings) };
  }
  return base;
};

export type MenuPopupOptions = {
  /** Defaults to the focused, else most-recent, window. */
  readonly window?: BrowserWindow;
  /** Content-relative; defaults to 0, not the mouse position (D040). */
  readonly x?: number;
  /** Content-relative; defaults to 0, not the mouse position (D040). */
  readonly y?: number;
};

export type PopupTarget = {
  popupMenu(menuHandle: bigint, x: number, y: number): void;
  closePopupMenu(): void;
};

/** Installed by browser-window at load: a runtime import of it here would be a cycle. */
export type WindowResolver = {
  focused(): PopupTarget | undefined;
  mostRecent(): PopupTarget | undefined;
  /** `undefined` when `window` is not a known open window. */
  resolve(window: unknown): PopupTarget | undefined;
  /** The window handed to `MenuItem.click`. */
  focusedWindow(): BrowserWindow | undefined;
};

let windowResolver: WindowResolver | undefined;

let quitHandler: (() => void) | undefined;

/** Called by `app` at load so the quit role can run `app.quit()` without an import cycle. @internal */
export const installQuitHandler = (handler: () => void): void => {
  quitHandler = handler;
};

let installedResolver: WindowResolver | undefined;

/** Called once at load by the BrowserWindow module. */
export const installWindowResolver = (resolver: WindowResolver): void => {
  installedResolver = resolver;
  windowResolver = resolver;
};

/** `undefined` restores the BrowserWindow module's resolver. @internal */
export const setWindowResolverForTesting = (fake: WindowResolver | undefined): void => {
  windowResolver = fake ?? installedResolver;
};

/** Explicit → focused → most-recent → throw. @internal */
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
  readonly items: MenuItem[] = [];
  #popupTarget: PopupTarget | undefined;

  append(item: MenuItem): void {
    this.items.push(item);
  }

  /** `pos` is clamped to the menu's bounds. */
  insert(pos: number, item: MenuItem): void {
    this.items.splice(Math.max(0, Math.min(pos, this.items.length)), 0, item);
  }

  /** Searches submenus depth-first; `null` if not found. */
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

  static buildFromTemplate(template: ReadonlyArray<MenuItemOptions | MenuItem>): Menu {
    const menu = new Menu();
    for (const entry of template) {
      menu.append(entry instanceof MenuItem ? entry : new MenuItem(entry));
    }
    return menu;
  }

  /** @internal */
  realize(): bigint {
    return getRealizer().realize(toSpecs(this.items));
  }

  /** `null` removes every menu bar, including installed ones; on macOS it empties the main menu. */
  static setApplicationMenu(menu: Menu | null): void {
    applicationMenuSet = true;
    applicationMenu = menu;
    getRealizer().setApplicationMenu(menu === null ? null : menu.realize());
  }

  static getApplicationMenu(): Menu | null {
    return applicationMenu;
  }

  /** Blocks on macOS and Windows (a native tracking loop, D040, D020-safe); returns at once on Linux. */
  popup(options?: MenuPopupOptions): void {
    if (windowResolver === undefined) {
      throw new BunmaskaError('Menu.popup is unavailable: no window backend installed');
    }
    const target = resolvePopupTarget(options, windowResolver);
    this.#popupTarget = target;
    target.popupMenu(this.realize(), options?.x ?? 0, options?.y ?? 0);
  }

  /** Where `popup` blocks, only useful re-entrantly, e.g. from an item's own click. */
  closePopup(window?: BrowserWindow): void {
    const target =
      window !== undefined
        ? windowResolver?.resolve(window)
        : (this.#popupTarget ?? windowResolver?.focused());
    target?.closePopupMenu();
  }
}

let applicationMenu: Menu | null = null;
let applicationMenuSet = false;

/** Electron's default menu minus unsupported roles; skipped once the app set one, even `null`. */
export const installDefaultApplicationMenu = (appName: string): void => {
  if (applicationMenuSet) {
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: appName,
        submenu: [
          { role: 'about', label: `About ${appName}` },
          { type: 'separator' },
          { role: 'hide', label: `Hide ${appName}` },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit', label: `Quit ${appName}` },
        ],
      },
      { label: 'File', submenu: [{ role: 'close' }] },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]),
  );
};

/** @internal */
export const resetApplicationMenuForTesting = (): void => {
  applicationMenu = null;
  applicationMenuSet = false;
};

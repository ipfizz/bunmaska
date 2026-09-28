import { JSCallback, type Pointer } from 'bun:ffi';
import type { MenuRealizer } from '../../api/menu';
import type { NativeMenuItemSpec } from '../macos/cocoa-menu';
import { cstr } from '../cstr';
import { loadGlibFFI } from './glib-ffi';
import { G_CONNECT_DEFAULT, loadGObjectFFI } from './gobject-ffi';
import { loadGMenuFFI } from './gtk-menu-ffi';
import { deferCallbackClose } from './gtk-signals';

/**
 * GMenu models plus one GSimpleActionGroup per realization, inserted as `bunmaska` (D039).
 * Activate thunks stay retained for the menu's lifetime and are never closed: GObject jumps
 * into a freed trampoline on the next click (a past SIGSEGV). No accelerators are installed (D035).
 */

/** `GSimpleAction::activate(action, parameter, user_data)`. */
const ACTION_ACTIVATE_CB_DEF = { args: ['ptr', 'ptr', 'ptr'], returns: 'void' } as const;

/** The prefix every realization's action group is inserted under. */
export const ACTION_GROUP_PREFIX = 'bunmaska';

let actionCounter = 0;

/** Process-unique, e.g. `menu-0`. */
export const actionName = (): string => `menu-${actionCounter++}`;

/** The `detailed_action` a GMenu item references, e.g. `bunmaska.menu-0`. */
export const detailedAction = (name: string): string => `${ACTION_GROUP_PREFIX}.${name}`;

type Closable = { close(): void };

export type Bindings = {
  gMenuNew(): bigint;
  gMenuAppend(menu: bigint, label: string, detailed: string): void;
  gMenuAppendSubmenu(menu: bigint, label: string, submenu: bigint): void;
  gMenuAppendSection(menu: bigint, section: bigint): void;
  gSimpleActionGroupNew(): bigint;
  gSimpleActionNew(name: string): bigint;
  /** A stateful boolean action (renders as a checked/unchecked menu item). */
  gSimpleActionNewStatefulBool(name: string, state: boolean): bigint;
  gSimpleActionSetEnabled(action: bigint, enabled: number): void;
  gActionMapAddAction(group: bigint, action: bigint): void;
  /** Returns the thunk, which the caller must retain. */
  connectActivate(action: bigint, thunk: () => void): Closable;
  /** `g_object_unref` a model or group handle. */
  unref(handle: bigint): void;
  /** Fire `detailed` on `group` without a click (tests). */
  activateAction(group: bigint, detailed: string, parameter: bigint | null): void;
};

export type MenuEntry = {
  /** Also the realizer's handle. */
  readonly model: bigint;
  /** Shared by the whole tree, submenus included. */
  readonly group: bigint;
  /** In realization order. */
  readonly actionNames: string[];
  /** Activate thunks; must outlive the menu. */
  readonly retained: Closable[];
  /** Kept so a window can re-realize the tree with role wiring. */
  readonly specs: ReadonlyArray<NativeMenuItemSpec>;
};

const menuEntries = new Map<bigint, MenuEntry>();

export type CurrentAppMenu = {
  readonly model: bigint;
  readonly group: bigint;
  readonly specs: ReadonlyArray<NativeMenuItemSpec>;
};

let currentAppMenu: CurrentAppMenu | undefined;

/** Live windows register here to swap their bar on every `setApplicationMenu`. */
const appMenuListeners = new Set<(menu: CurrentAppMenu | undefined) => void>();
export const onAppMenuChanged = (
  listener: (menu: CurrentAppMenu | undefined) => void,
): (() => void) => {
  appMenuListeners.add(listener);
  return () => {
    appMenuListeners.delete(listener);
  };
};

let injectedBindings: Bindings | undefined;

const realBindings = (): Bindings => {
  const gio = loadGMenuFFI();
  const gobject = loadGObjectFFI();
  const asPtr = (h: bigint): Pointer => Number(h) as unknown as Pointer;
  const asHandle = (p: Pointer | null): bigint => BigInt(p === null ? 0 : (p as unknown as number));
  return {
    gMenuNew: () => asHandle(gio.symbols.g_menu_new()),
    gMenuAppend: (menu, label, detailed) =>
      gio.symbols.g_menu_append(asPtr(menu), cstr(label), cstr(detailed)),
    gMenuAppendSubmenu: (menu, label, submenu) =>
      gio.symbols.g_menu_append_submenu(asPtr(menu), cstr(label), asPtr(submenu)),
    gMenuAppendSection: (menu, section) =>
      gio.symbols.g_menu_append_section(asPtr(menu), null, asPtr(section)),
    gSimpleActionGroupNew: () => asHandle(gio.symbols.g_simple_action_group_new()),
    gSimpleActionNew: (name) => asHandle(gio.symbols.g_simple_action_new(cstr(name), null)),
    gSimpleActionNewStatefulBool: (name, state) =>
      // g_variant_new_boolean returns a floating ref that new_stateful sinks.
      asHandle(
        gio.symbols.g_simple_action_new_stateful(
          cstr(name),
          null,
          loadGlibFFI().symbols.g_variant_new_boolean(state ? 1 : 0),
        ),
      ),
    gSimpleActionSetEnabled: (action, enabled) =>
      gio.symbols.g_simple_action_set_enabled(asPtr(action), enabled),
    gActionMapAddAction: (group, action) =>
      gio.symbols.g_action_map_add_action(asPtr(group), asPtr(action)),
    connectActivate: (action, thunk) => {
      const callback = new JSCallback(
        (_action: Pointer, _parameter: Pointer, _userData: Pointer): void => {
          thunk();
        },
        ACTION_ACTIVATE_CB_DEF,
      );
      gobject.symbols.g_signal_connect_data(
        asPtr(action),
        cstr('activate'),
        callback.ptr,
        null,
        null,
        G_CONNECT_DEFAULT,
      );
      return callback;
    },
    unref: (handle) => gobject.symbols.g_object_unref(asPtr(handle)),
    activateAction: (group, detailed, parameter) =>
      gio.symbols.g_action_group_activate_action(
        asPtr(group),
        cstr(detailed),
        parameter === null ? null : asPtr(parameter),
      ),
  };
};

const bindings = (): Bindings => injectedBindings ?? realBindings();

/** Override the native bindings. Test-only. */
export const setBindingsForTesting = (fake: Bindings | undefined): void => {
  injectedBindings = fake;
};

type WalkContext = {
  readonly b: Bindings;
  readonly group: bigint;
  readonly actionNames: string[];
  readonly retained: Closable[];
  /** Per-window role handler; when set, a role item is wired live to it instead of being inert. */
  readonly dispatchRole?: ((spec: NativeMenuItemSpec) => void) | undefined;
};

/** Electron `&` mnemonics as GTK underlines (`&&` is a literal `&`); literal `_` doubled. */
const gtkLabel = (label: string): string =>
  label.replace(/_/g, '__').replace(/&(&?)/g, (_match, escaped: string) => (escaped ? '&' : '_'));

/** Re-throw a click's error on a microtask: unwinding into the GLib dispatch loses it. */
const guarded = (thunk: () => void) => (): void => {
  try {
    thunk();
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
  }
};

const wireAction = (
  ctx: WalkContext,
  model: bigint,
  label: string,
  name: string,
  action: bigint,
  thunk: () => void,
): void => {
  ctx.retained.push(ctx.b.connectActivate(action, guarded(thunk)));
  ctx.b.gActionMapAddAction(ctx.group, action);
  ctx.actionNames.push(name);
  ctx.b.gMenuAppend(model, gtkLabel(label), detailedAction(name));
};

const appendItems = (
  ctx: WalkContext,
  root: bigint,
  items: ReadonlyArray<NativeMenuItemSpec>,
): void => {
  let model = root;
  for (const spec of items) {
    if (spec.type === 'separator') {
      // GTK draws a divider only above a NON-empty section, so later items go inside it.
      model = ctx.b.gMenuNew();
      ctx.b.gMenuAppendSection(root, model);
      continue;
    }
    if (spec.type === 'submenu' && spec.submenu !== undefined) {
      const child = ctx.b.gMenuNew();
      appendItems(ctx, child, spec.submenu);
      ctx.b.gMenuAppendSubmenu(model, gtkLabel(spec.label), child);
      continue;
    }
    // Role items act on THIS window via dispatchRole. Roles with no Linux action (quit, about)
    // or realized without a dispatcher fall through to an inert label (D039).
    if (
      spec.role !== undefined &&
      ctx.dispatchRole !== undefined &&
      (spec.editingCommand !== undefined || spec.windowAction !== undefined)
    ) {
      const name = actionName();
      const action = ctx.b.gSimpleActionNew(name);
      ctx.b.gSimpleActionSetEnabled(action, spec.enabled === false ? 0 : 1);
      const dispatch = ctx.dispatchRole;
      wireAction(ctx, model, spec.label, name, action, () => dispatch(spec));
      continue;
    }
    if ((spec.type === 'checkbox' || spec.type === 'radio') && spec.onClick !== undefined) {
      const name = actionName();
      const action = ctx.b.gSimpleActionNewStatefulBool(name, spec.checked ?? false);
      ctx.b.gSimpleActionSetEnabled(action, spec.enabled ? 1 : 0);
      wireAction(ctx, model, spec.label, name, action, spec.onClick);
      continue;
    }
    if (spec.type === 'normal' && spec.onClick !== undefined) {
      const name = actionName();
      const action = ctx.b.gSimpleActionNew(name);
      ctx.b.gSimpleActionSetEnabled(action, spec.enabled ? 1 : 0);
      wireAction(ctx, model, spec.label, name, action, spec.onClick);
      continue;
    }
    // No onClick: an inert label.
    ctx.b.gMenuAppend(model, gtkLabel(spec.label), detailedAction(actionName()));
  }
};

/** Realize `items` (role-wired when `dispatchRole` is given) and store the entry. */
const realizeCore = (
  items: ReadonlyArray<NativeMenuItemSpec>,
  dispatchRole?: (spec: NativeMenuItemSpec) => void,
): MenuEntry => {
  const b = bindings();
  const model = b.gMenuNew();
  const group = b.gSimpleActionGroupNew();
  const ctx: WalkContext = { b, group, actionNames: [], retained: [], dispatchRole };
  appendItems(ctx, model, items);
  const entry: MenuEntry = {
    model,
    group,
    actionNames: ctx.actionNames,
    retained: ctx.retained,
    specs: items,
  };
  menuEntries.set(model, entry);
  return entry;
};

/** Realize without role wiring; returns the model handle. */
const realize = (items: ReadonlyArray<NativeMenuItemSpec>): bigint => realizeCore(items).model;

/** A per-window realization whose role items dispatch to that window (D039). */
export const realizeForWindow = (
  items: ReadonlyArray<NativeMenuItemSpec>,
  dispatchRole: (spec: NativeMenuItemSpec) => void,
): MenuEntry => realizeCore(items, dispatchRole);

/**
 * Re-realize `handle` with its role items dispatching to one window, and release the original.
 * Only for a handle no widget ever showed: its actions are unreachable, so closing its thunks
 * cannot race a click.
 */
export const rewireForWindow = (
  handle: bigint,
  dispatchRole: (spec: NativeMenuItemSpec) => void,
): MenuEntry | undefined => {
  const original = menuEntries.get(handle);
  if (original === undefined) {
    return undefined;
  }
  menuEntries.delete(handle);
  const b = bindings();
  b.unref(original.model);
  b.unref(original.group);
  deferCallbackClose(original.retained);
  return realizeCore(original.specs, dispatchRole);
};

/** Also swaps (or, for `null`, removes) the bars of live windows, as Electron does on Linux. */
const setApplicationMenu = (menuHandle: bigint | null): void => {
  if (menuHandle === null) {
    currentAppMenu = undefined;
  } else {
    const entry = menuEntries.get(menuHandle);
    if (entry === undefined) {
      throw new Error(`setApplicationMenu: unknown menu handle ${menuHandle}`);
    }
    currentAppMenu = { model: entry.model, group: entry.group, specs: entry.specs };
  }
  for (const listener of [...appMenuListeners]) {
    listener(currentAppMenu);
  }
};

/** `undefined` for an unknown handle. */
export const getMenuEntry = (handle: bigint): MenuEntry | undefined => menuEntries.get(handle);

/** Read when a LinuxWindow is constructed, to attach its menu bar. */
export const getCurrentAppMenu = (): CurrentAppMenu | undefined => currentAppMenu;

/** Test-only. */
export const resetCurrentAppMenuForTesting = (): void => {
  currentAppMenu = undefined;
};

export const linuxMenuRealizer: MenuRealizer = {
  realize,
  setApplicationMenu,
};

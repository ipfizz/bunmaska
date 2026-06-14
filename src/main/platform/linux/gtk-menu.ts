import { JSCallback, type Pointer } from 'bun:ffi';
import type { MenuRealizer } from '../../api/menu';
import type { NativeMenuItemSpec } from '../macos/cocoa-menu';
import { cstr } from '../cstr';
import { G_CONNECT_DEFAULT, loadGObjectFFI } from './gobject-ffi';
import { loadGMenuFFI } from './gtk-menu-ffi';

/**
 * Builds native GTK 4 application menus from the backend-neutral menu spec and
 * routes item clicks back to JS — the Linux equivalent of `cocoa-menu.ts`.
 *
 * A GTK menu is a `GMenu` *model* paired with a `GSimpleActionGroup`. Each
 * clickable item is given a uniquely named `GSimpleAction` (e.g. `menu-0`); the
 * model entry references it as `"bunmaska.menu-0"`. Activating the action — by a
 * click, an accelerator, or `g_action_group_activate_action` — emits the
 * action's `activate` signal, which fires the item's JS `onClick`. This mirrors
 * the macOS `bunmaskaMenuAction:` registry pattern.
 *
 * One action group is shared by the whole tree (submenus add their actions to
 * the SAME group), so a single `gtk_widget_insert_action_group(window,
 * "bunmaska", group)` makes every item live.
 *
 * JSCallback lifecycle: the `activate` thunks are LONG-LIVED — they must stay
 * reachable for the menu's lifetime or GObject jumps into freed memory on the
 * next click (a past SIGSEGV class). Every thunk is therefore retained in the
 * per-menu {@link MenuEntry} (held by {@link menuEntries}) and NEVER closed
 * synchronously inside its own invocation. In v1 they are not closed at all.
 *
 * The native GIO/GObject calls are funnelled through an injectable
 * {@link Bindings} so the realizer's tree-walking, action-naming, and
 * click-routing logic is unit-testable on a non-Linux host without `dlopen`.
 */

/** ABI shape for `GSimpleAction::activate`: `(action, parameter, user_data) -> void`. */
export const ACTION_ACTIVATE_CB_DEF = { args: ['ptr', 'ptr', 'ptr'], returns: 'void' } as const;

/** The action-group namespace prefix inserted into the window. */
const ACTION_GROUP_PREFIX = 'bunmaska';

let actionCounter = 0;

/** A fresh, process-unique action name like `menu-0`, `menu-1`, … */
export const actionName = (): string => `menu-${actionCounter++}`;

/** Namespace an action name for a `GMenu` `detailed_action` (e.g. `bunmaska.menu-0`). */
export const detailedAction = (name: string): string => `${ACTION_GROUP_PREFIX}.${name}`;

/**
 * The native operations the realizer needs. Real implementation wraps GIO +
 * GObject FFI and {@link JSCallback}; tests inject a recording fake. Handles are
 * `bigint` here (the fake uses tagged numbers); the real binding casts to/from
 * `Pointer`.
 */
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
  /** Connect a retained `activate` handler to `action`; returns the retained thunk. */
  connectActivate(action: bigint, thunk: () => void): unknown;
  /** Programmatically fire `detailed` on `group` (the testing/verification path). */
  activateAction(group: bigint, detailed: string, parameter: bigint | null): void;
};

/** The realized native artefacts for one top-level menu, kept in {@link menuEntries}. */
export type MenuEntry = {
  /** The top-level `GMenu` model pointer (also the realizer's bigint handle). */
  readonly model: bigint;
  /** The `GSimpleActionGroup` shared by the whole tree. */
  readonly group: bigint;
  /** Action names (e.g. `menu-0`) in realization order, for lookup/verification. */
  readonly actionNames: string[];
  /** Retained activate thunks — kept alive for the menu's lifetime. */
  readonly retained: unknown[];
  /** Count of retained thunks (one per clickable item). */
  readonly retainedCount: number;
  /** The spec tree this entry was realized from (so a window can re-realize it with role wiring). */
  readonly specs: ReadonlyArray<NativeMenuItemSpec>;
};

const menuEntries = new Map<bigint, MenuEntry>();

type CurrentAppMenu = {
  readonly model: bigint;
  readonly group: bigint;
  readonly specs: ReadonlyArray<NativeMenuItemSpec>;
};

let currentAppMenu: CurrentAppMenu | undefined;

let injectedBindings: Bindings | undefined;

/** The real GIO/GObject-backed bindings (constructed lazily on Linux). */
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
          gio.symbols.g_variant_new_boolean(state ? 1 : 0),
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
  readonly retained: unknown[];
  /** Per-window role handler; when set, a role item is wired live to it instead of being inert. */
  readonly dispatchRole?: ((spec: NativeMenuItemSpec) => void) | undefined;
};

/** Append every spec in `items` to the `model`, wiring actions into the shared context. */
const appendItems = (
  ctx: WalkContext,
  model: bigint,
  items: ReadonlyArray<NativeMenuItemSpec>,
): void => {
  for (const spec of items) {
    if (spec.type === 'separator') {
      ctx.b.gMenuAppendSection(model, ctx.b.gMenuNew());
      continue;
    }
    if (spec.type === 'submenu' && spec.submenu !== undefined) {
      const child = ctx.b.gMenuNew();
      appendItems(ctx, child, spec.submenu);
      ctx.b.gMenuAppendSubmenu(model, spec.label, child);
      continue;
    }
    // A role item with a per-window dispatcher + a Linux action: wire its activate to the
    // dispatcher (which runs the editing command / window op on THIS window). Roles without a
    // Linux action (quit/about/…) or without a dispatcher fall through to the inert-label path.
    if (
      spec.role !== undefined &&
      ctx.dispatchRole !== undefined &&
      (spec.editingCommand !== undefined || spec.windowAction !== undefined)
    ) {
      const name = actionName();
      const action = ctx.b.gSimpleActionNew(name);
      ctx.b.gSimpleActionSetEnabled(action, spec.enabled === false ? 0 : 1);
      const dispatch = ctx.dispatchRole;
      const retained = ctx.b.connectActivate(action, () => dispatch(spec));
      ctx.b.gActionMapAddAction(ctx.group, action);
      ctx.actionNames.push(name);
      ctx.retained.push(retained);
      ctx.b.gMenuAppend(model, spec.label, detailedAction(name));
      continue;
    }
    if ((spec.type === 'checkbox' || spec.type === 'radio') && spec.onClick !== undefined) {
      const name = actionName();
      const action = ctx.b.gSimpleActionNewStatefulBool(name, spec.checked ?? false);
      ctx.b.gSimpleActionSetEnabled(action, spec.enabled ? 1 : 0);
      const retained = ctx.b.connectActivate(action, spec.onClick);
      ctx.b.gActionMapAddAction(ctx.group, action);
      ctx.actionNames.push(name);
      ctx.retained.push(retained);
      ctx.b.gMenuAppend(model, spec.label, detailedAction(name));
      continue;
    }
    if (spec.type === 'normal' && spec.onClick !== undefined) {
      const name = actionName();
      const action = ctx.b.gSimpleActionNew(name);
      ctx.b.gSimpleActionSetEnabled(action, spec.enabled ? 1 : 0);
      const retained = ctx.b.connectActivate(action, spec.onClick);
      ctx.b.gActionMapAddAction(ctx.group, action);
      ctx.actionNames.push(name);
      ctx.retained.push(retained);
      ctx.b.gMenuAppend(model, spec.label, detailedAction(name));
      continue;
    }
    // A normal item with no onClick: a static, inert label (e.g. a heading).
    ctx.b.gMenuAppend(model, spec.label, detailedAction(actionName()));
  }
};

/** Build a `GMenu` model + `GSimpleActionGroup` for `items` (optionally role-wired); stores + returns the entry. */
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
    retainedCount: ctx.retained.length,
    specs: items,
  };
  menuEntries.set(model, entry);
  return entry;
};

/** Build a shared model + group for `items` (no role wiring); returns the model handle. */
const realize = (items: ReadonlyArray<NativeMenuItemSpec>): bigint => realizeCore(items).model;

/**
 * Realize a PER-WINDOW model + group from `items`, wiring role items live to `dispatchRole`
 * (so their clicks act on that window's own web view / window). Returns the fresh entry.
 */
export const realizeForWindow = (
  items: ReadonlyArray<NativeMenuItemSpec>,
  dispatchRole: (spec: NativeMenuItemSpec) => void,
): MenuEntry => realizeCore(items, dispatchRole);

/** Install `menuHandle` as the current application menu (applied to future windows). */
const setApplicationMenu = (menuHandle: bigint): void => {
  const entry = menuEntries.get(menuHandle);
  if (entry === undefined) {
    throw new Error(`setApplicationMenu: unknown menu handle ${menuHandle}`);
  }
  currentAppMenu = { model: entry.model, group: entry.group, specs: entry.specs };
};

/** The realized artefacts for a handle, or `undefined`. Used by tests + verification. */
export const getMenuEntry = (handle: bigint): MenuEntry | undefined => menuEntries.get(handle);

/**
 * The model + action group of the current application menu, or `undefined` if
 * none is set. Read by {@link LinuxWindow} construction to attach a menu bar.
 */
export const getCurrentAppMenu = (): CurrentAppMenu | undefined => currentAppMenu;

/** Replace the current application menu state directly. @internal */
export const setCurrentAppMenu = (menu: CurrentAppMenu | undefined): void => {
  currentAppMenu = menu;
};

/** Clear the stored application menu. Test-only. */
export const resetCurrentAppMenuForTesting = (): void => {
  currentAppMenu = undefined;
};

/** The Linux native menu realizer (GMenu + GSimpleActionGroup + GtkPopoverMenuBar). */
export const linuxMenuRealizer: MenuRealizer = {
  realize,
  setApplicationMenu,
};

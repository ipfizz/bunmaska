import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * Loads the GIO `GMenu`/`GAction` model symbols and the GTK 4
 * `GtkPopoverMenuBar`/`GtkBox` widget symbols behind Bunmaska's Linux `Menu`
 * backend.
 *
 * A GTK 4 application menu bar is built from a backend-neutral *model* (`GMenu`,
 * a `GMenuModel`) wired to an *action group* (`GSimpleActionGroup`): each
 * clickable item names a `GAction` (e.g. `"bunmaska.menu-0"`), and activating
 * that action — via a click, an accelerator, or `g_action_group_activate_action`
 * — fires the action's `activate` signal. A `GtkPopoverMenuBar` renders the
 * model; the action group is inserted into the window under the `"bunmaska"`
 * prefix with `gtk_widget_insert_action_group`.
 *
 * Declared separately from the loaders so unit tests can assert ABI shapes (arg
 * arrays, return types) without `dlopen` on a non-Linux host.
 *
 * Convention (matches the existing Linux loaders): `gboolean` is modelled as
 * {@link FFIType.i32}; all GObject/GTK handles are real pointers
 * ({@link FFIType.pointer}); `cstring` args are NUL-terminated UTF-8 strings;
 * nullable pointer args (`param_type`, `param`) are passed as `null`.
 *
 * Only callable on Linux — throws {@link UnsupportedPlatformError} otherwise so
 * the module stays safely importable on macOS for unit testing.
 */

const LIBGIO_PATH = 'libgio-2.0.so.0';
const LIBGTK_PATH = 'libgtk-4.so.1';

/** The GIO `GMenu`/`GAction` FFI symbol descriptor table (from `libgio-2.0.so.0`). */
export const GMENU_FFI_SYMBOLS = {
  g_menu_new: {
    args: [],
    returns: FFIType.pointer,
  },
  // (menu, label, detailed_action /*e.g. "bunmaska.menu-0"*/) -> void
  g_menu_append: {
    args: [FFIType.pointer, FFIType.cstring, FFIType.cstring],
    returns: FFIType.void,
  },
  // (menu, label, submenu /*GMenuModel*/) -> void
  g_menu_append_submenu: {
    args: [FFIType.pointer, FFIType.cstring, FFIType.pointer],
    returns: FFIType.void,
  },
  // (menu, label /*null*/, section /*GMenuModel*/) -> void; renders a divider.
  g_menu_append_section: {
    args: [FFIType.pointer, FFIType.cstring, FFIType.pointer],
    returns: FFIType.void,
  },
  g_simple_action_group_new: {
    args: [],
    returns: FFIType.pointer,
  },
  // (name, parameter_type /*GVariantType* | null*/) -> GSimpleAction*
  g_simple_action_new: {
    args: [FFIType.cstring, FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (name, parameter_type /*null*/, state /*GVariant*, floating ref is sunk*/) -> GSimpleAction*
  g_simple_action_new_stateful: {
    args: [FFIType.cstring, FFIType.pointer, FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (value /*gboolean*/) -> GVariant* (floating ref)
  g_variant_new_boolean: {
    args: [FFIType.i32],
    returns: FFIType.pointer,
  },
  g_simple_action_set_enabled: {
    args: [FFIType.pointer, FFIType.i32],
    returns: FFIType.void,
  },
  // (action_map /*GActionMap*/, action /*GAction*/) -> void
  g_action_map_add_action: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  // (action_group, name, parameter /*GVariant* | null*/) -> void
  g_action_group_activate_action: {
    args: [FFIType.pointer, FFIType.cstring, FFIType.pointer],
    returns: FFIType.void,
  },
} as const;

/** The GTK 4 menu-bar/box FFI symbol descriptor table (from `libgtk-4.so.1`). */
export const GTK_MENU_FFI_SYMBOLS = {
  // (orientation /*GtkOrientation; vertical=1*/, spacing) -> GtkBox*
  gtk_box_new: {
    args: [FFIType.i32, FFIType.i32],
    returns: FFIType.pointer,
  },
  gtk_box_append: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  // (model /*GMenuModel*/) -> GtkPopoverMenuBar* (a GtkWidget)
  gtk_popover_menu_bar_new_from_model: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (widget, prefix /*e.g. "bunmaska"*/, group /*GActionGroup* | null*/) -> void
  gtk_widget_insert_action_group: {
    args: [FFIType.pointer, FFIType.cstring, FFIType.pointer],
    returns: FFIType.void,
  },
  // --- Context-menu popover (Menu.popup) ---
  // (model /*GMenuModel*/) -> GtkPopoverMenu* (a GtkPopover/GtkWidget)
  gtk_popover_menu_new_from_model: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (popover, rect /*const GdkRectangle**/) -> void; rect is in the PARENT widget's coords.
  gtk_popover_set_pointing_to: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  gtk_popover_popup: { args: [FFIType.pointer], returns: FFIType.void },
  gtk_popover_popdown: { args: [FFIType.pointer], returns: FFIType.void },
  // (widget, parent) -> void / (widget) -> void
  gtk_widget_set_parent: { args: [FFIType.pointer, FFIType.pointer], returns: FFIType.void },
  gtk_widget_unparent: { args: [FFIType.pointer], returns: FFIType.void },
} as const;

const cache: {
  gio: ReturnType<typeof dlopen<typeof GMENU_FFI_SYMBOLS>> | undefined;
  gtk: ReturnType<typeof dlopen<typeof GTK_MENU_FFI_SYMBOLS>> | undefined;
} = { gio: undefined, gtk: undefined };

const requireLinux = (fn: string): void => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `${fn}() is only supported on Linux; current platform is ${platform}`,
    );
  }
};

/** Open `libgio-2.0.so.0` and expose the `GMenu`/`GAction` model symbols. */
export const loadGMenuFFI = () => {
  requireLinux('loadGMenuFFI');
  if (cache.gio) {
    return cache.gio;
  }
  const ffi = dlopen(LIBGIO_PATH, GMENU_FFI_SYMBOLS);
  cache.gio = ffi;
  return ffi;
};

/** Open `libgtk-4.so.1` and expose the menu-bar/box widget symbols. */
export const loadGtkMenuFFI = () => {
  requireLinux('loadGtkMenuFFI');
  if (cache.gtk) {
    return cache.gtk;
  }
  const ffi = dlopen(LIBGTK_PATH, GTK_MENU_FFI_SYMBOLS);
  cache.gtk = ffi;
  return ffi;
};

import { FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import { dlopenLinux } from './glib-ffi';

const LIBGIO_PATH = 'libgio-2.0.so.0';
const LIBGTK_PATH = 'libgtk-4.so.1';

export const GMENU_FFI_SYMBOLS = {
  g_menu_new: {
    args: [],
    returns: FFIType.pointer,
  },
  // (menu, label, detailed_action) -> void. Actions are added to the group bare ("menu-0")
  //  but named here with the insert_action_group prefix ("bunmaska.menu-0").
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
  gtk_box_prepend: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  gtk_widget_set_vexpand: {
    args: [FFIType.pointer, FFIType.i32],
    returns: FFIType.void,
  },
  // (GtkBox*, GtkWidget* child) -> void
  gtk_box_remove: {
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
  gtk_widget_set_parent: { args: [FFIType.pointer, FFIType.pointer], returns: FFIType.void },
  gtk_widget_unparent: { args: [FFIType.pointer], returns: FFIType.void },
} as const;

const cache: {
  gio: ReturnType<typeof dlopenLinux<typeof GMENU_FFI_SYMBOLS>> | undefined;
  gtk: ReturnType<typeof dlopenLinux<typeof GTK_MENU_FFI_SYMBOLS>> | undefined;
} = { gio: undefined, gtk: undefined };

const requireLinux = (fn: string): void => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `${fn}() is only supported on Linux; current platform is ${platform}`,
    );
  }
};

export const loadGMenuFFI = () => {
  requireLinux('loadGMenuFFI');
  if (cache.gio) {
    return cache.gio;
  }
  const ffi = dlopenLinux(LIBGIO_PATH, GMENU_FFI_SYMBOLS);
  cache.gio = ffi;
  return ffi;
};

export const loadGtkMenuFFI = () => {
  requireLinux('loadGtkMenuFFI');
  if (cache.gtk) {
    return cache.gtk;
  }
  const ffi = dlopenLinux(LIBGTK_PATH, GTK_MENU_FFI_SYMBOLS);
  cache.gtk = ffi;
  return ffi;
};

import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { cstr } from '../../../src/main/platform/cstr';
import {
  getCurrentAppMenu,
  getMenuEntry,
  linuxMenuRealizer,
  resetCurrentAppMenuForTesting,
  setBindingsForTesting,
  setCurrentAppMenu,
} from '../../../src/main/platform/linux/gtk-menu';
import { loadGMenuFFI, loadGtkMenuFFI } from '../../../src/main/platform/linux/gtk-menu-ffi';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { createLinuxApplication } from '../../../src/main/platform/linux/linux-backend';
import type { NativeWindow } from '../../../src/main/platform/native';

/**
 * Linux-only. The REAL verification of the GTK 4 menu backend against live
 * libgio/libgtk under xvfb.
 *
 * Mirrors `cocoa-menu.test.ts` `performMenuItem`: build a menu via the real
 * realizer with an `onClick` that sets a flag, then fire the action through
 * `g_action_group_activate_action(group, "menu-N", null)` and assert the JS
 * `onClick` ran. Note the BARE action name (`menu-N`): a `GSimpleActionGroup`
 * keys actions by their own name; the `bunmaska.` prefix only applies when the
 * group is resolved through the window's inserted action namespace (the menu
 * bar). This proves click routing end-to-end (action model → signal → JSCallback
 * → JS) WITHOUT a synthetic pointer event.
 *
 * It also constructs a `GtkPopoverMenuBar` + `GtkBox` from a model (no crash),
 * verifies a window created AFTER `setApplicationMenu` builds without throwing
 * (the menu-bar window path), and verifies the default no-menu window path is
 * unchanged.
 *
 * Runs only under CI ubuntu (`xvfb-run -a`). Inert on macOS via `describe.skipIf`.
 */

const isLinux = currentPlatform() === 'linux';

const pump = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

describe.skipIf(!isLinux)('GTK menu backend (Linux)', () => {
  test('loadGMenuFFI / loadGtkMenuFFI resolve every menu symbol without throwing', () => {
    const gio = loadGMenuFFI();
    for (const name of [
      'g_menu_new',
      'g_menu_append',
      'g_menu_append_submenu',
      'g_menu_append_section',
      'g_simple_action_group_new',
      'g_simple_action_new',
      'g_simple_action_set_enabled',
      'g_action_map_add_action',
      'g_action_group_activate_action',
    ] as const) {
      expect(typeof gio.symbols[name]).toBe('function');
    }
    const gtk = loadGtkMenuFFI();
    for (const name of [
      'gtk_box_new',
      'gtk_box_append',
      'gtk_popover_menu_bar_new_from_model',
      'gtk_widget_insert_action_group',
    ] as const) {
      expect(typeof gtk.symbols[name]).toBe('function');
    }
  });

  test('activate_action fires the JS onClick (real click routing)', () => {
    // Use the REAL bindings (no injection) so the JSCallback path is exercised.
    setBindingsForTesting(undefined);
    let fired = 0;
    let firedOther = 0;
    const handle = linuxMenuRealizer.realize([
      {
        label: 'Fire',
        type: 'normal',
        enabled: true,
        keyEquivalent: '',
        onClick: () => {
          fired += 1;
        },
      },
      {
        label: 'Other',
        type: 'normal',
        enabled: true,
        keyEquivalent: '',
        onClick: () => {
          firedOther += 1;
        },
      },
    ]);
    const entry = getMenuEntry(handle);
    expect(entry).toBeDefined();
    const group = entry?.group as bigint;
    const names = entry?.actionNames ?? [];
    expect(names).toHaveLength(2);

    const gio = loadGMenuFFI();
    const asPtr = (h: bigint): import('bun:ffi').Pointer =>
      Number(h) as unknown as import('bun:ffi').Pointer;
    gio.symbols.g_action_group_activate_action(asPtr(group), cstr(`${names[0]}`), null);
    expect(fired).toBe(1);
    expect(firedOther).toBe(0);
    gio.symbols.g_action_group_activate_action(asPtr(group), cstr(`${names[1]}`), null);
    expect(fired).toBe(1);
    expect(firedOther).toBe(1);
  });

  test('constructs a GtkPopoverMenuBar + box from a model without crashing', () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return; // No display; symbol-resolution + activate routing above proved dispatch.
    }
    setBindingsForTesting(undefined);
    const handle = linuxMenuRealizer.realize([
      {
        label: 'File',
        type: 'submenu',
        enabled: true,
        keyEquivalent: '',
        submenu: [
          {
            label: 'New',
            type: 'normal',
            enabled: true,
            keyEquivalent: 'n',
            onClick: () => undefined,
          },
        ],
      },
    ]);
    const entry = getMenuEntry(handle);
    const gtk = loadGtkMenuFFI();
    const asPtr = (h: bigint): import('bun:ffi').Pointer =>
      Number(h) as unknown as import('bun:ffi').Pointer;
    const menuBar = gtk.symbols.gtk_popover_menu_bar_new_from_model(asPtr(entry?.model as bigint));
    expect(menuBar).not.toBeNull();
    const box = gtk.symbols.gtk_box_new(1 /* GTK_ORIENTATION_VERTICAL */, 0);
    expect(box).not.toBeNull();
    gtk.symbols.gtk_box_append(box, menuBar);
  });

  test('a window created AFTER setApplicationMenu builds without throwing (menu-bar path)', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    setBindingsForTesting(undefined);
    resetCurrentAppMenuForTesting();
    const handle = linuxMenuRealizer.realize([
      {
        label: 'App',
        type: 'submenu',
        enabled: true,
        keyEquivalent: '',
        submenu: [
          {
            label: 'Quit',
            type: 'normal',
            enabled: true,
            keyEquivalent: 'q',
            onClick: () => undefined,
          },
        ],
      },
    ]);
    linuxMenuRealizer.setApplicationMenu(handle);
    expect(getCurrentAppMenu()).toBeDefined();

    const app = createLinuxApplication();
    app.start();
    let window: NativeWindow | undefined;
    expect(() => {
      window = app.createWindow({ width: 320, height: 240, title: 'MenuBar', show: true });
    }).not.toThrow();
    await pump(100);
    window?.close();
    app.quit();
    resetCurrentAppMenuForTesting();
  });

  test('the default (no app menu) window path still builds without throwing', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    setCurrentAppMenu(undefined);
    const app = createLinuxApplication();
    app.start();
    let window: NativeWindow | undefined;
    expect(() => {
      window = app.createWindow({ width: 320, height: 240, title: 'NoMenu', show: true });
    }).not.toThrow();
    await pump(100);
    window?.close();
    app.quit();
  });
});

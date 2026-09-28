import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { NativeMenuItemSpec } from '../../../../src/main/platform/macos/cocoa-menu';
import type { BrowserWindow } from '../../../../src/main/api/browser-window';
import {
  installDefaultApplicationMenu,
  Menu,
  MenuItem,
  type MenuRealizer,
  type PopupTarget,
  resetApplicationMenuForTesting,
  resolvePopupTarget,
  installQuitHandler,
  setMenuRealizerForTesting,
  setWindowResolverForTesting,
} from '../../../../src/main/api/menu';

let realized: ReadonlyArray<NativeMenuItemSpec> | undefined;
let installed = 0;
let lastInstalledHandle: bigint | null | undefined;

beforeEach(() => {
  realized = undefined;
  installed = 0;
  lastInstalledHandle = undefined;
  const fake: MenuRealizer = {
    realize: (items) => {
      realized = items;
      return 1n;
    },
    setApplicationMenu: (handle) => {
      installed += 1;
      lastInstalledHandle = handle;
    },
  };
  setMenuRealizerForTesting(fake);
  resetApplicationMenuForTesting();
});

afterEach(() => {
  setMenuRealizerForTesting(undefined);
  resetApplicationMenuForTesting();
});

describe('the quit role', () => {
  test('clicking it runs the app quit where the OS has no native quit command', () => {
    let quits = 0;
    installQuitHandler(() => {
      quits += 1;
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ label: 'File', submenu: [{ role: 'quit' }] }]),
    );
    const quitItem = realized?.[0]?.submenu?.[0];
    expect(quitItem?.roleSelector).toBe('terminate:');
    quitItem?.onClick?.();
    expect(quits).toBe(1);
  });
});

describe('MenuItem', () => {
  test('defaults type to normal when no submenu', () => {
    expect(new MenuItem({ label: 'X' }).type).toBe('normal');
  });

  test('infers submenu type from a submenu array', () => {
    const item = new MenuItem({ label: 'File', submenu: [{ label: 'New' }] });
    expect(item.type).toBe('submenu');
    expect(item.submenu?.items).toHaveLength(1);
  });

  test('defaults enabled to true', () => {
    expect(new MenuItem({ label: 'X' }).enabled).toBe(true);
  });

  test('honours enabled: false', () => {
    expect(new MenuItem({ label: 'X', enabled: false }).enabled).toBe(false);
  });

  test('defaults checked to false and honours checked: true', () => {
    expect(new MenuItem({ label: 'X' }).checked).toBe(false);
    expect(new MenuItem({ label: 'X', type: 'checkbox', checked: true }).checked).toBe(true);
  });
});

describe('Menu checkbox/radio items', () => {
  test('a checkbox item realizes with its type, checked state, and click', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Wrap', type: 'checkbox', checked: true, click: () => undefined },
    ]);
    menu.realize();
    expect(realized?.[0]).toMatchObject({ label: 'Wrap', type: 'checkbox', checked: true });
    expect(typeof realized?.[0]?.onClick).toBe('function');
  });

  test('a radio item realizes with type radio', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Left', type: 'radio', checked: false, click: () => undefined },
    ]);
    menu.realize();
    expect(realized?.[0]).toMatchObject({ type: 'radio', checked: false });
  });

  test('clicking a checkbox flips checked before click sees the item', () => {
    let seen: boolean | undefined;
    const menu = Menu.buildFromTemplate([
      { label: 'Wrap', type: 'checkbox', checked: true, click: (item) => (seen = item.checked) },
    ]);
    menu.realize();
    realized?.[0]?.onClick?.();
    expect(seen).toBe(false);
    expect(menu.items[0]?.checked).toBe(false);
  });

  test('clicking a radio checks it and clears the rest of its separator-bounded group', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'A', type: 'radio', checked: true },
      { label: 'B', type: 'radio' },
      { type: 'separator' },
      { label: 'C', type: 'radio', checked: true },
    ]);
    menu.realize();
    realized?.[1]?.onClick?.();
    expect(menu.items.map((i) => i.checked)).toEqual([false, true, false, true]);
  });
});

describe('MenuItem roles', () => {
  test('a role fills the default label and accelerator', () => {
    const copy = new MenuItem({ role: 'copy' });
    expect(copy.role).toBe('copy');
    expect(copy.label).toBe('Copy');
    expect(copy.accelerator).toBe('CommandOrControl+C');
    expect(copy.type).toBe('normal');
  });

  test('an unsupported Electron role degrades to a plain item instead of throwing', () => {
    Menu.buildFromTemplate([{ role: 'toggleDevTools' as never }]).realize();
    expect(realized?.[0]).toMatchObject({ label: 'toggleDevTools', type: 'normal' });
    expect(realized?.[0]?.roleSelector).toBeUndefined();
  });

  test('roles match case-insensitively, as in Electron', () => {
    expect(new MenuItem({ role: 'selectall' as never }).role).toBe('selectAll');
    expect(new MenuItem({ role: 'editmenu' as never }).label).toBe('Edit');
  });

  test('an app-supplied label/accelerator overrides the role defaults', () => {
    const item = new MenuItem({
      role: 'copy',
      label: 'Copy Selection',
      accelerator: 'CmdOrCtrl+Shift+C',
    });
    expect(item.label).toBe('Copy Selection');
    expect(item.accelerator).toBe('CmdOrCtrl+Shift+C');
  });
});

describe('Menu macro roles', () => {
  test('editMenu expands into a labeled submenu of standard edit items', () => {
    const item = new MenuItem({ role: 'editMenu' });
    expect(item.label).toBe('Edit');
    expect(item.type).toBe('submenu');
    expect(item.role).toBeUndefined();
    const roles = item.submenu?.items.map((i) => i.role ?? i.type);
    expect(roles).toEqual([
      'undo',
      'redo',
      'separator',
      'cut',
      'copy',
      'paste',
      'pasteAndMatchStyle',
      'delete',
      'selectAll',
    ]);
  });

  test('windowMenu expands into minimize/zoom/separator/close', () => {
    const menu = Menu.buildFromTemplate([{ role: 'windowMenu' }]);
    const windowItem = menu.items[0];
    expect(windowItem?.label).toBe('Window');
    expect(windowItem?.submenu?.items.map((i) => i.role ?? i.type)).toEqual([
      'minimize',
      'zoom',
      'separator',
      'close',
    ]);
  });

  test('a macro role keeps an explicitly supplied submenu', () => {
    const item = new MenuItem({ role: 'editMenu', submenu: [{ label: 'Mine' }] });
    expect(item.submenu?.items.map((i) => i.label)).toEqual(['Mine']);
  });

  test('a macro role accepts a custom label', () => {
    expect(new MenuItem({ role: 'editMenu', label: 'Edit…' }).label).toBe('Edit…');
  });
});

describe('Menu role realization spec', () => {
  test('a role item realizes with its macOS selector and no onClick', () => {
    const menu = Menu.buildFromTemplate([{ role: 'copy' }]);
    menu.realize();
    expect(realized?.[0]).toMatchObject({ role: 'copy', roleSelector: 'copy:', label: 'Copy' });
    expect(realized?.[0]?.onClick).toBeUndefined();
  });

  test('a role takes precedence over an explicit click (no onClick synthesized)', () => {
    const menu = Menu.buildFromTemplate([{ role: 'paste', click: () => undefined }]);
    menu.realize();
    expect(realized?.[0]?.roleSelector).toBe('paste:');
    expect(realized?.[0]?.onClick).toBeUndefined();
  });

  test('redo carries a Shift modifier mask, distinct from undo (no collision)', () => {
    Menu.buildFromTemplate([{ role: 'undo' }, { role: 'redo' }]).realize();
    const shiftBit = 1n << 17n;
    expect(realized?.[0]?.keyEquivalent).toBe('z'); // undo
    expect((realized?.[0]?.modifierMask ?? 0n) & shiftBit).toBe(0n);
    expect(realized?.[1]?.keyEquivalent).toBe('z'); // redo
    expect((realized?.[1]?.modifierMask ?? 0n) & shiftBit).toBe(shiftBit);
  });

  test('a no-accelerator role (delete) emits an empty key equivalent and no mask', () => {
    Menu.buildFromTemplate([{ role: 'delete' }]).realize();
    expect(realized?.[0]?.roleSelector).toBe('delete:');
    expect(realized?.[0]?.keyEquivalent).toBe('');
    expect(realized?.[0]?.modifierMask).toBeUndefined();
  });
});

describe('Menu.insert / getMenuItemById', () => {
  test('insert places an item at the given position (clamped)', () => {
    const menu = Menu.buildFromTemplate([{ label: 'A' }, { label: 'C' }]);
    menu.insert(1, new MenuItem({ label: 'B' }));
    menu.insert(99, new MenuItem({ label: 'D' }));
    menu.insert(-5, new MenuItem({ label: '0' }));
    expect(menu.items.map((i) => i.label)).toEqual(['0', 'A', 'B', 'C', 'D']);
  });

  test('getMenuItemById finds an item by id, including inside submenus', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'File', submenu: [{ label: 'Open', id: 'open' }] },
      { label: 'X', id: 'x' },
    ]);
    expect(menu.getMenuItemById('open')?.label).toBe('Open');
    expect(menu.getMenuItemById('x')?.label).toBe('X');
    expect(menu.getMenuItemById('missing')).toBeNull();
  });
});

describe('Menu.popup target resolution', () => {
  const makeTarget = (): { target: PopupTarget; calls: Array<{ fn: string; args: unknown[] }> } => {
    const calls: Array<{ fn: string; args: unknown[] }> = [];
    return {
      calls,
      target: {
        popupMenu: (h, x, y) => calls.push({ fn: 'popupMenu', args: [h, x, y] }),
        closePopupMenu: () => calls.push({ fn: 'closePopupMenu', args: [] }),
      },
    };
  };

  afterEach(() => setWindowResolverForTesting(undefined));

  test('uses the explicit window option and forwards the realized handle + coords', () => {
    const { target, calls } = makeTarget();
    const sentinel = {} as BrowserWindow;
    setWindowResolverForTesting({
      focused: () => undefined,
      mostRecent: () => undefined,
      resolve: (w) => (w === sentinel ? target : undefined),
    });
    Menu.buildFromTemplate([{ label: 'Cut' }]).popup({ window: sentinel, x: 12, y: 34 });
    expect(calls).toEqual([{ fn: 'popupMenu', args: [1n, 12, 34] }]);
  });

  test('falls back to focused (then most-recent); x/y default to 0', () => {
    const focused = makeTarget();
    setWindowResolverForTesting({
      focused: () => focused.target,
      mostRecent: () => undefined,
      resolve: () => undefined,
    });
    Menu.buildFromTemplate([{ label: 'X' }]).popup();
    expect(focused.calls[0]?.fn).toBe('popupMenu');
    expect(focused.calls[0]?.args.slice(1)).toEqual([0, 0]);
  });

  test('throws when no window option and no open window', () => {
    setWindowResolverForTesting({
      focused: () => undefined,
      mostRecent: () => undefined,
      resolve: () => undefined,
    });
    expect(() => Menu.buildFromTemplate([{ label: 'X' }]).popup()).toThrow(/no open window/);
  });

  test('resolvePopupTarget throws when the given window is unknown', () => {
    expect(() =>
      resolvePopupTarget(
        { window: {} as BrowserWindow },
        { focused: () => undefined, mostRecent: () => undefined, resolve: () => undefined },
      ),
    ).toThrow(/not an open/);
  });

  test('closePopup(window) routes to that window target', () => {
    const { target, calls } = makeTarget();
    const w = {} as BrowserWindow;
    setWindowResolverForTesting({
      focused: () => undefined,
      mostRecent: () => undefined,
      resolve: (x) => (x === w ? target : undefined),
    });
    Menu.buildFromTemplate([{ label: 'X' }]).closePopup(w);
    expect(calls).toEqual([{ fn: 'closePopupMenu', args: [] }]);
  });
});

describe('Menu.buildFromTemplate', () => {
  test('creates a MenuItem per template entry, in order', () => {
    const menu = Menu.buildFromTemplate([{ label: 'A' }, { label: 'B' }]);
    expect(menu.items.map((i) => i.label)).toEqual(['A', 'B']);
  });

  test('append adds to the end', () => {
    const menu = new Menu();
    menu.append(new MenuItem({ label: 'A' }));
    menu.append(new MenuItem({ label: 'B' }));
    expect(menu.items.map((i) => i.label)).toEqual(['A', 'B']);
  });
});

describe('Menu realization spec', () => {
  test('setApplicationMenu realizes the tree and installs it once', () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'App' }]));
    expect(installed).toBe(1);
    expect(realized).toHaveLength(1);
    expect(realized?.[0]?.label).toBe('App');
  });

  test('setApplicationMenu(null) reaches the realizer and clears', () => {
    // It used to update only the JS getter, leaving the native bar installed.
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'App' }]));
    Menu.setApplicationMenu(null);
    expect(installed).toBe(2);
    expect(lastInstalledHandle).toBeNull();
    expect(Menu.getApplicationMenu()).toBeNull();
  });

  test('maps an accelerator down to its key equivalent', () => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ label: 'Quit', accelerator: 'CmdOrCtrl+Q' }]),
    );
    expect(realized?.[0]?.keyEquivalent).toBe('q');
  });

  test('maps named keys to AppKit key equivalents (NSEvent.h function-key unicodes)', () => {
    const cases: Array<[string, string]> = [
      ['CmdOrCtrl+Plus', '+'],
      ['F1', ''],
      ['F11', ''],
      ['Up', ''],
      ['Right', ''],
      ['Delete', ''],
      ['Backspace', '\b'],
      ['Escape', '\u001b'],
      ['PageDown', ''],
    ];
    Menu.buildFromTemplate(cases.map(([accelerator]) => ({ label: 'x', accelerator }))).realize();
    expect(realized?.map((spec) => spec.keyEquivalent)).toEqual(cases.map(([, key]) => key));
  });

  test('a modifier-less accelerator sends an explicit empty mask, not AppKit Command', () => {
    Menu.buildFromTemplate([{ label: 'Full Screen', accelerator: 'F11' }]).realize();
    expect(realized?.[0]?.modifierMask).toBe(0n);
  });

  test('Super lands on Command in the macOS mask', () => {
    Menu.buildFromTemplate([{ label: 'x', accelerator: 'Super+K' }]).realize();
    expect(realized?.[0]?.modifierMask).toBe(1n << 20n);
  });

  test('click receives the item, the focused window and an event, as in Electron', () => {
    const focused = {} as BrowserWindow;
    setWindowResolverForTesting({
      focused: () => undefined,
      mostRecent: () => undefined,
      resolve: () => undefined,
      focusedWindow: () => focused,
    });
    const calls: unknown[][] = [];
    const menu = Menu.buildFromTemplate([{ label: 'Go', click: (...args) => calls.push(args) }]);
    Menu.setApplicationMenu(menu);
    realized?.[0]?.onClick?.();
    setWindowResolverForTesting(undefined);
    expect(calls).toEqual([[menu.items[0], focused, {}]]);
  });

  test('nests submenu specs', () => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ label: 'File', submenu: [{ label: 'New' }, { label: 'Open' }] }]),
    );
    expect(realized?.[0]?.type).toBe('submenu');
    expect(realized?.[0]?.submenu).toHaveLength(2);
  });

  test('separators become separator specs', () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ type: 'separator' }]));
    expect(realized?.[0]?.type).toBe('separator');
  });
});

describe('installDefaultApplicationMenu', () => {
  test('installs App, File, Edit and Window menus when the app set none', () => {
    installDefaultApplicationMenu('Notes');
    expect(realized?.map((spec) => spec.label)).toEqual(['Notes', 'File', 'Edit', 'Window']);
    expect(realized?.[0]?.submenu?.at(-1)).toMatchObject({ label: 'Quit Notes', role: 'quit' });
    expect(Menu.getApplicationMenu()).not.toBeNull();
  });

  test('leaves an app-set menu, including null, alone', () => {
    Menu.setApplicationMenu(null);
    installDefaultApplicationMenu('Notes');
    expect(installed).toBe(1);
    expect(Menu.getApplicationMenu()).toBeNull();
  });
});

describe('Menu.getApplicationMenu', () => {
  test('returns null before any menu is set', () => {
    expect(Menu.getApplicationMenu()).toBeNull();
  });

  test('returns the menu after setApplicationMenu', () => {
    const menu = Menu.buildFromTemplate([{ label: 'App' }]);
    Menu.setApplicationMenu(menu);
    expect(Menu.getApplicationMenu()).toBe(menu);
  });
});

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { NativeMenuItemSpec } from '../../../../src/main/platform/macos/cocoa-menu';
import type { BrowserWindow } from '../../../../src/main/api/browser-window';
import {
  Menu,
  MenuItem,
  type MenuRealizer,
  type PopupTarget,
  resetApplicationMenuForTesting,
  resolvePopupTarget,
  setMenuRealizerForTesting,
  setWindowResolverForTesting,
} from '../../../../src/main/api/menu';

let realized: ReadonlyArray<NativeMenuItemSpec> | undefined;
let installed = 0;

beforeEach(() => {
  realized = undefined;
  installed = 0;
  const fake: MenuRealizer = {
    realize: (items) => {
      realized = items;
      return 1n;
    },
    setApplicationMenu: () => {
      installed += 1;
    },
  };
  setMenuRealizerForTesting(fake);
  resetApplicationMenuForTesting();
});

afterEach(() => {
  setMenuRealizerForTesting(undefined);
  resetApplicationMenuForTesting();
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
});

describe('MenuItem roles', () => {
  test('a role fills the default label and accelerator', () => {
    const copy = new MenuItem({ role: 'copy' });
    expect(copy.role).toBe('copy');
    expect(copy.label).toBe('Copy');
    expect(copy.accelerator).toBe('CommandOrControl+C');
    expect(copy.type).toBe('normal');
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
    expect(menu.items.map((i) => i.label)).toEqual(['A', 'B', 'C']);
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

  test('maps an accelerator down to its key equivalent', () => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ label: 'Quit', accelerator: 'CmdOrCtrl+Q' }]),
    );
    expect(realized?.[0]?.keyEquivalent).toBe('q');
  });

  test('carries the click handler through to the spec', () => {
    const click = (): void => undefined;
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Go', click }]));
    expect(realized?.[0]?.onClick).toBe(click);
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

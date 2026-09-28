import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import type { NativeMenuItemSpec } from '../../../src/main/platform/macos/cocoa-menu';
import { loadUser32 } from '../../../src/main/platform/windows/win32-ffi';
import {
  type AppMenuWindow,
  createWindowsMenuRealizer,
} from '../../../src/main/platform/windows/windows-menu';

/**
 * Windows menu realizer against real Win32 menus. Building the HMENU is NON-modal,
 * so it is fully exercised here (item count, submenus, command dispatch); only the
 * `TrackPopupMenu` popup is modal and untested (like macOS menu tracking). A fresh
 * factory realizer gives each test an isolated command-id space (first clickable
 * item → id 1). Runs only on a Windows host; inert elsewhere.
 */
const item = (overrides: Partial<NativeMenuItemSpec>): NativeMenuItemSpec => ({
  label: 'Item',
  type: 'normal',
  enabled: true,
  keyEquivalent: '',
  ...overrides,
});

const target = (actions: string[] = []): AppMenuWindow => ({
  setMenuBar: () => undefined,
  performWindowAction: (action) => actions.push(action),
});

describe.skipIf(currentPlatform() !== 'windows')('Windows menu realizer', () => {
  test('realize builds a non-zero HMENU with the right item count', () => {
    const realizer = createWindowsMenuRealizer();
    const handle = realizer.realize([
      item({ label: 'New' }),
      item({ type: 'separator' }),
      item({
        label: 'More',
        type: 'submenu',
        submenu: [item({ label: 'A' }), item({ label: 'B' })],
      }),
    ]);
    expect(handle).not.toBe(0n);
    // Top level: New, separator, More → 3 items.
    expect(loadUser32().symbols.GetMenuItemCount(handle)).toBe(3);
    loadUser32().symbols.DestroyMenu(handle);
  });

  test('dispatchMenuCommand fires the clicked item’s onClick (first clickable = id 1)', () => {
    const realizer = createWindowsMenuRealizer();
    let clicks = 0;
    const handle = realizer.realize([item({ label: 'Click me', onClick: () => clicks++ })]);
    realizer.dispatchMenuCommand(1, target());
    expect(clicks).toBe(1);
    // An unknown command id is a harmless no-op.
    realizer.dispatchMenuCommand(999, target());
    expect(clicks).toBe(1);
    loadUser32().symbols.DestroyMenu(handle);
  });

  test('the quit role keeps its click, since Windows has no native quit command', () => {
    const realizer = createWindowsMenuRealizer();
    let quits = 0;
    const handle = realizer.realize([
      item({ label: 'Quit', role: 'quit', onClick: () => quits++ }),
    ]);
    realizer.dispatchMenuCommand(1, target());
    expect(quits).toBe(1);
    loadUser32().symbols.DestroyMenu(handle);
  });

  test('an editing role item stores no JS click, so its id dispatches to nothing', () => {
    const realizer = createWindowsMenuRealizer();
    let clicks = 0;
    const handle = realizer.realize([
      item({ label: 'Copy', role: 'copy', onClick: () => clicks++ }),
    ]);
    realizer.dispatchMenuCommand(1, target());
    expect(clicks).toBe(0);
    loadUser32().symbols.DestroyMenu(handle);
  });

  test('a window role item runs its action on the dispatching window', () => {
    const realizer = createWindowsMenuRealizer();
    const actions: string[] = [];
    const handle = realizer.realize([
      item({ label: 'Minimize', role: 'minimize', windowAction: 'minimize' }),
    ]);
    realizer.dispatchMenuCommand(1, target(actions));
    expect(actions).toEqual(['minimize']);
    loadUser32().symbols.DestroyMenu(handle);
  });

  test('setApplicationMenu destroys the realized popup tree it read the items from', () => {
    const realizer = createWindowsMenuRealizer();
    const handle = realizer.realize([item({ label: 'File' })]);
    realizer.setApplicationMenu(handle);
    expect(loadUser32().symbols.GetMenuItemCount(handle)).toBe(-1);
  });
});

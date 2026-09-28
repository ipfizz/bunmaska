import { describe, expect, test } from 'bun:test';
import type { NativeMenuItemSpec } from '../../../../../src/main/platform/macos/cocoa-menu';
import {
  type AppMenuWindow,
  createWindowsMenuRealizer,
  menuItemFlags,
} from '../../../../../src/main/platform/windows/windows-menu';

const MF_STRING = 0x0;
const MF_GRAYED = 0x1;
const MF_CHECKED = 0x8;
const MF_POPUP = 0x10;
const MF_SEPARATOR = 0x800;

describe('menuItemFlags', () => {
  test('enabled/checked compose into MF_GRAYED and MF_CHECKED', () => {
    expect(menuItemFlags(true, false)).toBe(MF_STRING);
    expect(menuItemFlags(false, false)).toBe(MF_GRAYED);
    expect(menuItemFlags(true, true)).toBe(MF_CHECKED);
    expect(menuItemFlags(false, true)).toBe(MF_GRAYED | MF_CHECKED);
  });
});

/** A user32 stand-in recording command ids appended and menus destroyed. */
const fakeUser32 = () => {
  let nextHandle = 100n;
  const commandIds: number[] = [];
  const destroyed: unknown[] = [];
  const api = {
    CreateMenu: () => nextHandle++,
    CreatePopupMenu: () => nextHandle++,
    AppendMenuW: (_menu: unknown, flags: unknown, id: unknown) => {
      if ((Number(flags) & (MF_POPUP | MF_SEPARATOR)) === 0) {
        commandIds.push(Number(id));
      }
      return 1;
    },
    DestroyMenu: (menu: unknown) => {
      destroyed.push(menu);
      return 1;
    },
  };
  return { api, commandIds, destroyed };
};

const item = (label: string, onClick?: () => void): NativeMenuItemSpec => ({
  label,
  type: 'normal',
  enabled: true,
  keyEquivalent: '',
  ...(onClick !== undefined ? { onClick } : {}),
});

const window = (): AppMenuWindow => ({ setMenuBar: () => undefined });

describe('createWindowsMenuRealizer command ids', () => {
  test('stay within the 16-bit WM_COMMAND id across 70k popups and fire the newest click', () => {
    const fake = fakeUser32();
    const realizer = createWindowsMenuRealizer(() => fake.api);
    const fired: number[] = [];
    for (let i = 0; i < 70_000; i += 1) {
      realizer.realize([item('Item', () => fired.push(i))]);
    }
    expect(Math.max(...fake.commandIds)).toBeLessThanOrEqual(0xffff);
    realizer.dispatchMenuCommand(fake.commandIds.at(-1) ?? 0);
    expect(fired).toEqual([69_999]);
  });

  test('an application menu bar item keeps its click after the ids wrap around', () => {
    const fake = fakeUser32();
    const realizer = createWindowsMenuRealizer(() => fake.api);
    realizer.registerAppMenuWindow(window());
    const fired: string[] = [];
    realizer.setApplicationMenu(realizer.realize([item('Open', () => fired.push('open'))]));
    const barId = fake.commandIds.at(-1) ?? 0;
    for (let i = 0; i < 70_000; i += 1) {
      realizer.realize([item('Popup', () => fired.push('popup'))]);
    }
    realizer.dispatchMenuCommand(barId);
    expect(fired).toEqual(['open']);
  });

  test('a replaced application menu no longer holds its click handlers', () => {
    const fake = fakeUser32();
    const realizer = createWindowsMenuRealizer(() => fake.api);
    realizer.registerAppMenuWindow(window());
    const fired: string[] = [];
    realizer.setApplicationMenu(realizer.realize([item('Old', () => fired.push('old'))]));
    const oldBarId = fake.commandIds.at(-1) ?? 0;
    realizer.setApplicationMenu(realizer.realize([item('New', () => fired.push('new'))]));
    realizer.dispatchMenuCommand(oldBarId);
    expect(fired).toEqual([]);
  });
});

describe('createWindowsMenuRealizer setApplicationMenu', () => {
  test('destroys the realized popup tree it only reads the items from', () => {
    const fake = fakeUser32();
    const realizer = createWindowsMenuRealizer(() => fake.api);
    const handle = realizer.realize([item('File')]);
    realizer.setApplicationMenu(handle);
    expect(fake.destroyed).toEqual([handle]);
  });
});

import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import type { NativeMenuItemSpec } from '../../../src/main/platform/macos/cocoa-menu';
import { loadUser32 } from '../../../src/main/platform/windows/win32-ffi';
import { createWindowsMenuRealizer } from '../../../src/main/platform/windows/windows-menu';

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

if (currentPlatform() === 'windows') {
  describe('Windows menu realizer', () => {
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
      realizer.dispatchMenuCommand(1);
      expect(clicks).toBe(1);
      // An unknown command id is a harmless no-op.
      realizer.dispatchMenuCommand(999);
      expect(clicks).toBe(1);
      loadUser32().symbols.DestroyMenu(handle);
    });

    test('a role item is native (no JS click stored), so its id dispatches to nothing', () => {
      const realizer = createWindowsMenuRealizer();
      let clicks = 0;
      // A role item with a stray onClick must NOT be wired (role behavior is native).
      const handle = realizer.realize([
        item({ label: 'Copy', role: 'copy', onClick: () => clicks++ }),
      ]);
      realizer.dispatchMenuCommand(1);
      expect(clicks).toBe(0);
      loadUser32().symbols.DestroyMenu(handle);
    });

    test('setApplicationMenu is a no-op (per-window menu bar is deferred)', () => {
      const realizer = createWindowsMenuRealizer();
      const handle = realizer.realize([item({ label: 'File' })]);
      expect(() => realizer.setApplicationMenu(handle)).not.toThrow();
      loadUser32().symbols.DestroyMenu(handle);
    });
  });
}

import { beforeAll, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  clickRegistrySize,
  disposeMenu,
  menuItemCount,
  performMenuItem,
  realizeMenu,
  setApplicationMenu,
} from '../../../src/main/platform/macos/cocoa-menu';
import {
  msgSendI64,
  msgSendReturnsI64,
  msgSendReturnsU8,
} from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import type { Handle } from '../../../src/main/platform/macos/objc';
import { objcWeakRef } from '../../helpers/objc-weak';
import type { NativeMenuItemSpec } from '../../../src/main/platform/services';

/** Realize one item and run AppKit's autoenable pass, as opening the menu or a key press does. */
const realizeAndValidate = (spec: NativeMenuItemSpec): { menu: Handle; item: Handle } => {
  const rt = cocoa();
  const menu = realizeMenu([spec]);
  rt.msgSend(menu, rt.selectors.get('update'));
  return { menu, item: msgSendI64(menu, rt.selectors.get('itemAtIndex:'), 0n) };
};

const appSubmenu = (): NativeMenuItemSpec => ({
  label: 'App',
  type: 'submenu',
  enabled: true,
  keyEquivalent: '',
  submenu: [
    { label: 'About', type: 'normal', enabled: true, keyEquivalent: '', onClick: () => undefined },
  ],
});

/** Bun.sleep(0) resolves before a pending setTimeout(0); this waits for it. */
const nextTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const isEnabled = (item: Handle): boolean =>
  msgSendReturnsU8(item, cocoa().selectors.get('isEnabled')) === 1;

const itemStates = (menu: Handle): bigint[] => {
  const rt = cocoa();
  return Array.from({ length: menuItemCount(menu) }, (_, i) =>
    msgSendReturnsI64(
      msgSendI64(menu, rt.selectors.get('itemAtIndex:'), BigInt(i)),
      rt.selectors.get('state'),
    ),
  );
};

if (currentPlatform() === 'macos') {
  describe('cocoa-menu', () => {
    // performActionForItemAtIndex: dispatches through NSApp; without it nothing fires.
    beforeAll(() => {
      const rt = cocoa();
      rt.msgSend(rt.classes.get('NSApplication'), rt.selectors.get('sharedApplication'));
    });

    test('realizeMenu builds a menu whose item count matches the spec', () => {
      const menu = realizeMenu([
        { label: 'One', type: 'normal', enabled: true, keyEquivalent: '' },
        { label: '', type: 'separator', enabled: true, keyEquivalent: '' },
        { label: 'Two', type: 'normal', enabled: true, keyEquivalent: '' },
      ]);
      expect(menuItemCount(menu)).toBe(3);
    });

    test('a role item wires the first-responder selector with a nil target', () => {
      const rt = cocoa();
      const menu = realizeMenu([
        {
          label: 'Copy',
          type: 'normal',
          enabled: true,
          keyEquivalent: 'c',
          role: 'copy',
          roleSelector: 'copy:',
        },
      ]);
      const item = msgSendI64(menu, rt.selectors.get('itemAtIndex:'), 0n);
      // action == @selector(copy:); target == nil (0n) so AppKit uses the responder chain.
      expect(rt.msgSend(item, rt.selectors.get('action'))).toBe(rt.selectors.get('copy:'));
      expect(rt.msgSend(item, rt.selectors.get('target'))).toBe(0n);
    });

    test('performMenuItem fires the clicked item JS callback with the right item', () => {
      const fired: string[] = [];
      const menu = realizeMenu([
        {
          label: 'Alpha',
          type: 'normal',
          enabled: true,
          keyEquivalent: '',
          onClick: () => fired.push('alpha'),
        },
        {
          label: 'Beta',
          type: 'normal',
          enabled: true,
          keyEquivalent: '',
          onClick: () => fired.push('beta'),
        },
      ]);
      performMenuItem(menu, 1);
      performMenuItem(menu, 0);
      expect(fired).toEqual(['beta', 'alpha']);
    });

    test('a disabled item stays disabled through autoenable and does not fire', () => {
      let fired = false;
      const { menu, item } = realizeAndValidate({
        label: 'Save',
        type: 'normal',
        enabled: false,
        keyEquivalent: 's',
        modifierMask: 1n << 20n,
        onClick: () => {
          fired = true;
        },
      });
      expect(isEnabled(item)).toBe(false);
      performMenuItem(menu, 0);
      expect(fired).toBe(false);
    });

    test('a role item with enabled:false stays disabled through autoenable', () => {
      const { item } = realizeAndValidate({
        label: 'Quit',
        type: 'normal',
        enabled: false,
        keyEquivalent: 'q',
        role: 'quit',
        roleSelector: 'terminate:',
      });
      expect(isEnabled(item)).toBe(false);
    });

    test('an enabled item without a click handler renders enabled', () => {
      const { item } = realizeAndValidate({
        label: 'Info',
        type: 'normal',
        enabled: true,
        keyEquivalent: '',
      });
      expect(isEnabled(item)).toBe(true);
    });

    test('a bare-key accelerator carries no Command modifier', () => {
      const { item } = realizeAndValidate({
        label: 'Search',
        type: 'normal',
        enabled: true,
        keyEquivalent: '/',
      });
      expect(msgSendReturnsI64(item, cocoa().selectors.get('keyEquivalentModifierMask'))).toBe(0n);
    });

    test('clicking a checkbox toggles its check mark', () => {
      const menu = realizeMenu([
        { label: 'Wrap', type: 'checkbox', enabled: true, checked: false, keyEquivalent: '' },
      ]);
      performMenuItem(menu, 0);
      expect(itemStates(menu)).toEqual([1n]);
      performMenuItem(menu, 0);
      expect(itemStates(menu)).toEqual([0n]);
    });

    test('clicking a radio checks it and clears only its adjacent radio group', () => {
      const radio = (checked: boolean): NativeMenuItemSpec => ({
        label: 'R',
        type: 'radio',
        enabled: true,
        checked,
        keyEquivalent: '',
      });
      const separator: NativeMenuItemSpec = {
        label: '',
        type: 'separator',
        enabled: true,
        keyEquivalent: '',
      };
      const menu = realizeMenu([radio(false), radio(true), separator, radio(true)]);
      performMenuItem(menu, 0);
      expect(itemStates(menu)).toEqual([1n, 0n, 0n, 1n]);
    });

    test('a submenu is realized with its own items', () => {
      const rt = cocoa();
      const menu = realizeMenu([
        {
          label: 'File',
          type: 'submenu',
          enabled: true,
          keyEquivalent: '',
          submenu: [
            { label: 'New', type: 'normal', enabled: true, keyEquivalent: 'n' },
            { label: 'Open', type: 'normal', enabled: true, keyEquivalent: 'o' },
          ],
        },
      ]);
      expect(menuItemCount(menu)).toBe(1);
      const fileItem = msgSendI64(menu, rt.selectors.get('itemAtIndex:'), 0n);
      const submenu = rt.msgSend(fileItem, rt.selectors.get('submenu'));
      expect(menuItemCount(submenu)).toBe(2);
    });

    test('setApplicationMenu installs the menu as the main menu', () => {
      const rt = cocoa();
      const menu = realizeMenu([appSubmenu()]);
      setApplicationMenu(menu);
      const app = rt.msgSend(
        rt.classes.get('NSApplication'),
        rt.selectors.get('sharedApplication'),
      );
      expect(rt.msgSend(app, rt.selectors.get('mainMenu'))).toBe(menu);
    });

    test('disposeMenu frees the whole tree and forgets its handlers', async () => {
      const rt = cocoa();
      await nextTick();
      const registered = clickRegistrySize();
      const menu = realizeMenu([appSubmenu()]);
      const submenu = rt.msgSend(
        msgSendI64(menu, rt.selectors.get('itemAtIndex:'), 0n),
        rt.selectors.get('submenu'),
      );
      const menuRef = objcWeakRef(menu);
      const itemRef = objcWeakRef(msgSendI64(submenu, rt.selectors.get('itemAtIndex:'), 0n));

      disposeMenu(menu);
      await nextTick();

      expect(menuRef()).toBe(0n);
      expect(itemRef()).toBe(0n);
      expect(clickRegistrySize()).toBe(registered);
    });

    // AppKit may hold the outgoing main menu past a tick, so this checks our side only.
    test('replacing the application menu disposes the old one', async () => {
      setApplicationMenu(realizeMenu([appSubmenu()]));
      await nextTick();
      const registered = clickRegistrySize();

      setApplicationMenu(realizeMenu([appSubmenu()]));
      await nextTick();

      expect(clickRegistrySize()).toBe(registered);
    });
  });
}

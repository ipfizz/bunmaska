import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { msgSendI64 } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import {
  menuItemCount,
  performMenuItem,
  realizeMenu,
  setApplicationMenu,
} from '../../../src/main/platform/macos/cocoa-menu';

if (currentPlatform() === 'macos') {
  describe('cocoa-menu', () => {
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

    test('a disabled item does not fire when performed', () => {
      let fired = false;
      const menu = realizeMenu([
        {
          label: 'Nope',
          type: 'normal',
          enabled: false,
          keyEquivalent: '',
          onClick: () => {
            fired = true;
          },
        },
      ]);
      performMenuItem(menu, 0);
      expect(fired).toBe(false);
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

    test('setApplicationMenu installs the menu without throwing', () => {
      const menu = realizeMenu([
        {
          label: 'App',
          type: 'submenu',
          enabled: true,
          keyEquivalent: '',
          submenu: [{ label: 'Quit', type: 'normal', enabled: true, keyEquivalent: 'q' }],
        },
      ]);
      expect(() => setApplicationMenu(menu)).not.toThrow();
    });
  });
}

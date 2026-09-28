import { nsString } from './cocoa-foundation';
import {
  msgSendI64,
  msgSendPtr,
  msgSendPtr3,
  msgSendPtrPointPtrReturnsU8,
  msgSendReturnsI64,
  msgSendReturnsU8,
  msgSendU8,
} from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { Handle } from './objc';

/**
 * Builds native `NSMenu` trees from a backend-neutral menu spec and routes item
 * clicks back to JS.
 *
 * A single shared `BunmaskaMenuTarget` class (defined once at runtime, D026) holds
 * the `bunmaskaMenuAction:` selector that every clickable item points at. When an
 * item fires, AppKit sends `[target bunmaskaMenuAction:item]`; the IMP looks the
 * item handle up in a registry and invokes its JS click handler.
 */

/** A backend-neutral description of one menu item. */
export type NativeMenuItemSpec = {
  readonly label: string;
  readonly type: 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';
  readonly enabled: boolean;
  /** Whether a checkbox/radio item renders checked (defaults to unchecked). */
  readonly checked?: boolean;
  /** Single-character key equivalent (e.g. `'q'`), or `''` for none. */
  readonly keyEquivalent: string;
  /** `NSEventModifierFlags` mask for the key equivalent; absent means no modifiers. */
  readonly modifierMask?: bigint;
  /** A predefined role name (the item's behavior is native, not a JS click). */
  readonly role?: string;
  /** The macOS first-responder selector for a role item (e.g. `'copy:'`). */
  readonly roleSelector?: string;
  /** Linux: a WebKitGTK editing command a role runs on the focused web view (e.g. `'Copy'`). */
  readonly editingCommand?: string;
  /** Linux: a GTK window op a role performs (e.g. `'minimize'`). */
  readonly windowAction?: 'minimize' | 'close' | 'zoom' | 'togglefullscreen';
  readonly submenu?: ReadonlyArray<NativeMenuItemSpec>;
  readonly onClick?: () => void;
};

const clickRegistry = new Map<Handle, NativeMenuItemSpec>();

let targetClass: Handle | undefined;
let sharedTarget: Handle | undefined;

const setState = (item: Handle, on: boolean): void => {
  msgSendI64(item, cocoa().selectors.get('setState:'), on ? 1n : 0n);
};

/** Electron semantics: a checkbox flips; a radio turns on and clears its adjacent radios. */
const toggleChecked = (item: Handle, type: 'checkbox' | 'radio'): void => {
  const rt = cocoa();
  if (type === 'checkbox') {
    setState(item, msgSendReturnsI64(item, rt.selectors.get('state')) === 0n);
    return;
  }
  const menu = rt.msgSend(item, rt.selectors.get('menu'));
  const index = Number(msgSendPtr(menu, rt.selectors.get('indexOfItem:'), item));
  const count = Number(msgSendReturnsI64(menu, rt.selectors.get('numberOfItems')));
  const at = (i: number): Handle => msgSendI64(menu, rt.selectors.get('itemAtIndex:'), BigInt(i));
  for (const step of [-1, 1]) {
    for (let i = index + step; i >= 0 && i < count; i += step) {
      if (clickRegistry.get(at(i))?.type !== 'radio') {
        break;
      }
      setState(at(i), false);
    }
  }
  setState(item, true);
};

const ensureTarget = (): Handle => {
  if (sharedTarget !== undefined) {
    return sharedTarget;
  }
  const rt = cocoa();
  targetClass = defineObjcClass('BunmaskaMenuTarget', 'NSObject', [
    {
      selector: 'bunmaskaMenuAction:',
      typeEncoding: 'v@:@',
      args: ['object'],
      impl: (_self, _cmd, sender) => {
        const spec = clickRegistry.get(sender);
        if (spec?.type === 'checkbox' || spec?.type === 'radio') {
          toggleChecked(sender, spec.type);
        }
        spec?.onClick?.();
      },
    },
    {
      // AppKit autoenabling overwrites setEnabled: with this answer on every menu update.
      selector: 'validateMenuItem:',
      typeEncoding: 'c@:@',
      args: ['object'],
      returns: 'bool',
      impl: (_self, _cmd, item) => msgSendReturnsU8(item, rt.selectors.get('isEnabled')),
    },
  ]);
  sharedTarget = rt.msgSend(
    rt.msgSend(targetClass, rt.selectors.get('alloc')),
    rt.selectors.get('init'),
  );
  return sharedTarget;
};

const realizeItem = (spec: NativeMenuItemSpec): Handle => {
  const rt = cocoa();
  if (spec.type === 'separator') {
    return rt.msgSend(rt.classes.get('NSMenuItem'), rt.selectors.get('separatorItem'));
  }

  const checkable = spec.type === 'checkbox' || spec.type === 'radio';
  // A role item's action is the native first-responder selector with a NIL target,
  // so AppKit routes it up the responder chain (no BunmaskaMenuTarget / clickRegistry).
  const isRole = spec.roleSelector !== undefined;
  const targeted = !isRole && (spec.type === 'normal' || checkable);
  // A nil action is the only way to keep a responder-chain role disabled under autoenabling.
  const action =
    isRole && spec.enabled
      ? rt.selectors.get(spec.roleSelector as string)
      : targeted
        ? rt.selectors.get('bunmaskaMenuAction:')
        : 0n;
  const item = msgSendPtr3(
    rt.msgSend(rt.classes.get('NSMenuItem'), rt.selectors.get('alloc')),
    rt.selectors.get('initWithTitle:action:keyEquivalent:'),
    nsString(spec.label),
    action,
    nsString(spec.keyEquivalent),
  );

  if (targeted) {
    msgSendPtr(item, rt.selectors.get('setTarget:'), ensureTarget());
    clickRegistry.set(item, spec);
  }

  // Apply the explicit modifier mask so multi-modifier accelerators (e.g. redo's
  // Shift+Cmd+Z) don't collapse to AppKit's Command-only default.
  if (spec.keyEquivalent !== '') {
    msgSendI64(item, rt.selectors.get('setKeyEquivalentModifierMask:'), spec.modifierMask ?? 0n);
  }

  if (checkable) {
    setState(item, spec.checked === true);
  }

  // For role items, let AppKit auto-enable via the responder chain (Copy greys out
  // when nothing is selected); only honor an explicit `enabled: false`.
  if (!isRole) {
    msgSendU8(item, rt.selectors.get('setEnabled:'), spec.enabled ? 1 : 0);
  } else if (spec.enabled === false) {
    msgSendU8(item, rt.selectors.get('setEnabled:'), 0);
  }

  if (spec.type === 'submenu' && spec.submenu !== undefined) {
    const submenu = realizeMenu(spec.submenu);
    msgSendPtr(item, rt.selectors.get('setSubmenu:'), submenu);
    rt.msgSend(submenu, rt.selectors.get('release'));
  }

  return item;
};

/** Build an `NSMenu` from a list of item specs. Returns the menu handle. */
export const realizeMenu = (items: ReadonlyArray<NativeMenuItemSpec>): Handle => {
  const rt = cocoa();
  const menu = rt.msgSend(
    rt.msgSend(rt.classes.get('NSMenu'), rt.selectors.get('alloc')),
    rt.selectors.get('init'),
  );
  for (const spec of items) {
    const item = realizeItem(spec);
    msgSendPtr(menu, rt.selectors.get('addItem:'), item);
    if (spec.type !== 'separator') {
      rt.msgSend(item, rt.selectors.get('release')); // separatorItem is +0
    }
  }
  return menu;
};

const forgetItems = (menu: Handle): void => {
  const rt = cocoa();
  for (let i = menuItemCount(menu) - 1; i >= 0; i -= 1) {
    const item = msgSendI64(menu, rt.selectors.get('itemAtIndex:'), BigInt(i));
    clickRegistry.delete(item);
    const submenu = rt.msgSend(item, rt.selectors.get('submenu'));
    if (submenu !== 0n) {
      forgetItems(submenu);
    }
  }
};

/**
 * Drop a realized menu's handlers and our +1 on it. Deferred a tick, never inline:
 * a click handler may be replacing the very menu AppKit is dispatching from.
 */
export const disposeMenu = (menu: Handle): void => {
  if (menu === 0n) {
    return;
  }
  setTimeout(() => {
    forgetItems(menu);
    cocoa().msgSend(menu, cocoa().selectors.get('release'));
  }, 0);
};

let mainMenu: Handle = 0n;
let lastPopup: Handle = 0n;

/** Install `menu` as the application's main menu bar. */
/** Install `menu` as the main menu; `0n` (nil) clears the menu bar. */
export const setApplicationMenu = (menu: Handle): void => {
  const rt = cocoa();
  const app = rt.msgSend(rt.classes.get('NSApplication'), rt.selectors.get('sharedApplication'));
  msgSendPtr(app, rt.selectors.get('setMainMenu:'), menu);
  if (mainMenu !== menu) {
    disposeMenu(mainMenu);
    mainMenu = menu;
  }
};

/** @internal */
export const clickRegistrySize = (): number => clickRegistry.size;

/** Number of items in a realized menu. Used for verification. */
export const menuItemCount = (menu: Handle): number =>
  Number(msgSendReturnsI64(menu, cocoa().selectors.get('numberOfItems')));

/**
 * Programmatically trigger the item at `index` in `menu`, as if clicked.
 * Used for testing the click path without a real event loop.
 */
export const performMenuItem = (menu: Handle, index: number): void => {
  msgSendI64(menu, cocoa().selectors.get('performActionForItemAtIndex:'), BigInt(index));
};

/**
 * Show `menu` as a context menu at content-relative (`x`, `y`) in `view`.
 *
 * BLOCKING: `popUpMenuPositioningItem:atLocation:inView:` runs a nested AppKit tracking loop
 * until the user picks an item or dismisses — the same nested-modal-loop class as the dialog
 * panels' `runModal` (D020: safe; the crash class was a blocking `runUntilDate:`, not an
 * AppKit-owned nested loop). Item clicks route through the shared `BunmaskaMenuTarget` registry
 * exactly as for an application menu. `item = nil` anchors the menu's top-left at the location.
 */
export const popUpMenu = (menu: Handle, view: Handle, x: number, y: number): boolean => {
  // ponytail: the previous popup tree lives until the next popup; freeing it on return would race a click AppKit may still deliver.
  if (lastPopup !== menu) {
    disposeMenu(lastPopup);
    lastPopup = menu;
  }
  return (
    msgSendPtrPointPtrReturnsU8(
      menu,
      cocoa().selectors.get('popUpMenuPositioningItem:atLocation:inView:'),
      0n, // item = nil
      x,
      y,
      view,
    ) === 1
  );
};

/** Cancel an in-progress context-menu tracking session (`-[NSMenu cancelTracking]`). */
export const cancelMenuTracking = (menu: Handle): void => {
  cocoa().msgSend(menu, cocoa().selectors.get('cancelTracking'));
};

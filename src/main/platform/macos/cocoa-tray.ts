import type { TrayBackend, TrayInstance, TrayImageOptions } from '../services';
import { nsString } from './cocoa-foundation';
import { disposeMenu } from './cocoa-menu';
import { msgSendF64, msgSendPtr, msgSendU8 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { Handle } from './objc';

/** `NSVariableStatusItemLength`. */
const NS_VARIABLE_STATUS_ITEM_LENGTH = -1;

const clickRegistry = new Map<Handle, () => void>();

let sharedTarget: Handle | undefined;

const ensureTarget = (): Handle => {
  if (sharedTarget !== undefined) {
    return sharedTarget;
  }
  const rt = cocoa();
  const targetClass = defineObjcClass('BunmaskaTrayTarget', 'NSObject', [
    {
      selector: 'bunmaskaTrayAction:',
      typeEncoding: 'v@:@',
      args: ['object'],
      impl: (_self, _cmd, sender) => {
        clickRegistry.get(sender)?.();
      },
    },
  ]);
  sharedTarget = rt.msgSend(
    rt.msgSend(targetClass, rt.selectors.get('alloc')),
    rt.selectors.get('init'),
  );
  return sharedTarget;
};

const systemStatusBar = (): Handle => {
  const rt = cocoa();
  return rt.msgSend(rt.classes.get('NSStatusBar'), rt.selectors.get('systemStatusBar'));
};

/** Load an `NSImage` from a file path; returns `0n` for a bad/unreadable path. */
const imageFromPath = (path: string): Handle => {
  const rt = cocoa();
  return msgSendPtr(
    rt.msgSend(rt.classes.get('NSImage'), rt.selectors.get('alloc')),
    rt.selectors.get('initWithContentsOfFile:'),
    nsString(path),
  );
};

const create = (image: string, options?: TrayImageOptions): TrayInstance => {
  const rt = cocoa();
  const statusBar = systemStatusBar();
  const rawItem = msgSendF64(
    statusBar,
    rt.selectors.get('statusItemWithLength:'),
    NS_VARIABLE_STATUS_ITEM_LENGTH,
  );
  // statusItemWithLength: returns +0; hold our own reference until destroy() releases it.
  const item = rt.msgSend(rawItem, rt.selectors.get('retain'));

  const button = (): Handle => rt.msgSend(item, rt.selectors.get('button'));

  const applyImage = (path: string, template: boolean): void => {
    const btn = button();
    if (btn === 0n) {
      return;
    }
    const img = imageFromPath(path);
    if (img !== 0n) {
      // A template image lets the menu bar recolor it for light/dark.
      msgSendU8(img, rt.selectors.get('setTemplate:'), template ? 1 : 0);
      msgSendPtr(btn, rt.selectors.get('setImage:'), img);
      rt.msgSend(img, rt.selectors.get('release')); // the button retains it
    }
  };
  applyImage(image, options?.template === true);

  let destroyed = false;
  let contextMenu: Handle = 0n;

  return {
    setToolTip: (toolTip) => {
      const btn = button();
      if (btn !== 0n) {
        msgSendPtr(btn, rt.selectors.get('setToolTip:'), nsString(toolTip));
      }
    },
    setTitle: (title) => {
      const btn = button();
      if (btn !== 0n) {
        msgSendPtr(btn, rt.selectors.get('setTitle:'), nsString(title));
      }
    },
    setImage: (path, options) => {
      applyImage(path, options?.template === true);
    },
    setContextMenu: (menu) => {
      const nsMenu: Handle = menu === null ? 0n : menu.realize();
      msgSendPtr(item, rt.selectors.get('setMenu:'), nsMenu);
      disposeMenu(contextMenu);
      contextMenu = nsMenu;
    },
    onClick: (cb) => {
      const btn = button();
      if (btn === 0n) {
        return;
      }
      clickRegistry.set(btn, cb);
      msgSendPtr(btn, rt.selectors.get('setTarget:'), ensureTarget());
      msgSendPtr(btn, rt.selectors.get('setAction:'), rt.selectors.get('bunmaskaTrayAction:'));
    },
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      const btn = button();
      if (btn !== 0n) {
        clickRegistry.delete(btn);
      }
      msgSendPtr(systemStatusBar(), rt.selectors.get('removeStatusItem:'), item);
      rt.msgSend(item, rt.selectors.get('release'));
      disposeMenu(contextMenu);
      contextMenu = 0n;
    },
    isDestroyed: () => destroyed,
  };
};

export const macosTrayBackend: TrayBackend = {
  create,
};

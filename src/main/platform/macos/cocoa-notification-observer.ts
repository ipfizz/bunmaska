import { nsString } from './cocoa-foundation';
import { msgSendPtr4 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { Handle } from './objc';

/** Cocoa notification observers (D034). */

const registry = new Map<Handle, () => void>();
let observerClass: Handle | undefined;

const ensureObserverClass = (): Handle => {
  if (observerClass !== undefined) {
    return observerClass;
  }
  observerClass = defineObjcClass('BunmaskaNotificationObserver', 'NSObject', [
    {
      selector: 'bunmaskaNotify:',
      typeEncoding: 'v@:@',
      args: ['object'],
      impl: (self) => {
        registry.get(self)?.();
      },
    },
  ]);
  return observerClass;
};

/** The NSWorkspace center: sleep and wake. */
export const workspaceNotificationCenter = (): Handle => {
  const rt = cocoa();
  const workspace = rt.msgSend(rt.classes.get('NSWorkspace'), rt.selectors.get('sharedWorkspace'));
  return rt.msgSend(workspace, rt.selectors.get('notificationCenter'));
};

/** The distributed center: system-wide appearance and screen-lock notifications. */
export const distributedNotificationCenter = (): Handle => {
  const rt = cocoa();
  return rt.msgSend(
    rt.classes.get('NSDistributedNotificationCenter'),
    rt.selectors.get('defaultCenter'),
  );
};

/**
 * Call `onPost` whenever `name` is posted on `center`. The observer's alloc/init +1 is
 * never released: notification centers do NOT retain their observers.
 */
export const observeNotification = (center: Handle, name: string, onPost: () => void): void => {
  const rt = cocoa();
  const cls = ensureObserverClass();
  const observer = rt.msgSend(rt.msgSend(cls, rt.selectors.get('alloc')), rt.selectors.get('init'));
  registry.set(observer, onPost);
  msgSendPtr4(
    center,
    rt.selectors.get('addObserver:selector:name:object:'),
    observer,
    rt.selectors.get('bunmaskaNotify:'),
    nsString(name),
    0n,
  );
};

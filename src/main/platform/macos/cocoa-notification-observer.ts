import { nsString } from './cocoa-foundation';
import { msgSendPtr4 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { Handle } from './objc';

/**
 * A reusable Cocoa notification observer (D034).
 *
 * One shared `BunmaskaNotificationObserver` class (defined once at runtime, D026)
 * carries a single `bunmaskaNotify:` selector; each registration owns an instance
 * whose JS handler is looked up by the instance handle. The instance is retained
 * for the process lifetime — notification centers do NOT retain their observers.
 * Notifications are delivered on the pumped main run loop (D020/D021).
 */

const registry = new Map<Handle, () => void>();
const retainedObservers: Handle[] = [];
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

/** `[[NSWorkspace sharedWorkspace] notificationCenter]` — the source of sleep/wake events. */
export const workspaceNotificationCenter = (): Handle => {
  const rt = cocoa();
  const workspace = rt.msgSend(rt.classes.get('NSWorkspace'), rt.selectors.get('sharedWorkspace'));
  return rt.msgSend(workspace, rt.selectors.get('notificationCenter'));
};

/** `[NSDistributedNotificationCenter defaultCenter]` — system-wide notifications (appearance, lock). */
export const distributedNotificationCenter = (): Handle => {
  const rt = cocoa();
  return rt.msgSend(
    rt.classes.get('NSDistributedNotificationCenter'),
    rt.selectors.get('defaultCenter'),
  );
};

/**
 * Register `onPost` to fire whenever `name` is posted on `center`. The observer
 * instance is retained for the process lifetime.
 */
export const observeNotification = (center: Handle, name: string, onPost: () => void): void => {
  const rt = cocoa();
  const cls = ensureObserverClass();
  const observer = rt.msgSend(rt.msgSend(cls, rt.selectors.get('alloc')), rt.selectors.get('init'));
  registry.set(observer, onPost);
  retainedObservers.push(observer);
  msgSendPtr4(
    center,
    rt.selectors.get('addObserver:selector:name:object:'),
    observer,
    rt.selectors.get('bunmaskaNotify:'),
    nsString(name),
    0n,
  );
};

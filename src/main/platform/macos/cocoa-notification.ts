import type { NotificationBackend, NotificationHandle, NotificationSpec } from '../services';
import { nsString } from './cocoa-foundation';
import { msgSendPtr } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { Handle } from './objc';

// ponytail: deprecated NSUserNotification, since UNUserNotificationCenter needs an app bundle; switch once apps always ship bundled.
// Un-bundled the default center is nil, so nothing is delivered (messaging nil is a no-op).

const defaultCenter = (): Handle => {
  const rt = cocoa();
  return rt.msgSend(
    rt.classes.get('NSUserNotificationCenter'),
    rt.selectors.get('defaultUserNotificationCenter'),
  );
};

let delegate: Handle | undefined;

/** The center holds its delegate weakly, so this one lives for the process. */
export const notificationDelegate = (): Handle => {
  if (delegate !== undefined) {
    return delegate;
  }
  const rt = cocoa();
  const cls = defineObjcClass('BunmaskaNotificationDelegate', 'NSObject', [
    {
      // Without a YES here AppKit skips the banner while the app is frontmost.
      selector: 'userNotificationCenter:shouldPresentNotification:',
      typeEncoding: 'c@:@@',
      args: ['object', 'object'],
      returns: 'bool',
      impl: () => 1,
    },
  ]);
  delegate = rt.msgSend(rt.msgSend(cls, rt.selectors.get('alloc')), rt.selectors.get('init'));
  return delegate;
};

const buildNotification = (spec: NotificationSpec): Handle => {
  const rt = cocoa();
  const notification = rt.msgSend(
    rt.msgSend(rt.classes.get('NSUserNotification'), rt.selectors.get('alloc')),
    rt.selectors.get('init'),
  );
  msgSendPtr(notification, rt.selectors.get('setTitle:'), nsString(spec.title));
  msgSendPtr(notification, rt.selectors.get('setInformativeText:'), nsString(spec.body));
  if (spec.subtitle.length > 0) {
    msgSendPtr(notification, rt.selectors.get('setSubtitle:'), nsString(spec.subtitle));
  }
  // NSUserNotification is silent unless soundName is set.
  if (!spec.silent) {
    msgSendPtr(
      notification,
      rt.selectors.get('setSoundName:'),
      nsString('NSUserNotificationDefaultSoundName'),
    );
  }
  return notification;
};

const present = (spec: NotificationSpec): NotificationHandle => {
  const rt = cocoa();
  const notification = buildNotification(spec);
  const center = defaultCenter();
  if (center !== 0n) {
    msgSendPtr(center, rt.selectors.get('setDelegate:'), notificationDelegate());
    msgSendPtr(center, rt.selectors.get('deliverNotification:'), notification);
  }
  return {
    close: () => {
      const c = defaultCenter();
      if (c !== 0n) {
        msgSendPtr(c, rt.selectors.get('removeDeliveredNotification:'), notification);
      }
    },
    onClosed: () => undefined, // ponytail: the center reports no dismissals; poll deliveredNotifications if 'close' is needed.
  };
};

/** True only in a bundled app, where the default center is non-nil. */
const isSupported = (): boolean => {
  try {
    return defaultCenter() !== 0n;
  } catch {
    return false;
  }
};

export const macosNotificationBackend: NotificationBackend = {
  isSupported,
  present,
};

import type {
  NotificationBackend,
  NotificationHandle,
  NotificationSpec,
} from '../../api/notification';
import { nsString } from './cocoa-foundation';
import { msgSendPtr } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import type { Handle } from './objc';

/**
 * macOS notifications via the deprecated `NSUserNotification` /
 * `NSUserNotificationCenter` API — the macOS half of Sambar's `Notification`.
 *
 * WHY the deprecated API: the modern `UNUserNotificationCenter` REQUIRES a real
 * app bundle (Info.plist + bundle id). Sambar runs un-bundled (`bun main.ts`),
 * so `UNUserNotificationCenter` is non-viable here. `NSUserNotification` is the
 * un-bundled-friendlier path.
 *
 * EMPIRICAL FINDING (measured on a real macOS host, un-bundled): the
 * `NSUserNotification` class resolves, `alloc/init` and the `setTitle:` /
 * `setInformativeText:` / `setSubtitle:` setters run cleanly with NO crash — but
 * `[NSUserNotificationCenter defaultUserNotificationCenter]` returns **nil**
 * without an app bundle. So delivery does NOT actually happen un-bundled, even
 * though the FFI path is clean. Sending `deliverNotification:` to a nil center is
 * a safe Objective-C no-op (verified, no SIGSEGV).
 *
 * Consequently:
 * - {@link isSupported} returns `false` when the default center is nil (the
 *   un-bundled reality). It returns `true` only if a bundle ever makes the center
 *   non-nil.
 * - {@link present} is defensive best-effort: it builds the notification and, if
 *   a center exists, delivers it; if the center is nil it no-ops cleanly without
 *   throwing. We do NOT fake delivery.
 *
 * Reliable macOS delivery is a PACKAGING follow-up (ship Sambar as a code-signed
 * .app bundle with a bundle id, then migrate to `UNUserNotificationCenter`).
 *
 * `close` event wiring (an `NSUserNotificationCenterDelegate`) is NOT wired here:
 * un-bundled there is no center to attach a delegate to, so it would never fire.
 * The handle's `onClosed` is therefore a no-op on macOS (best-effort, honest).
 */

const defaultCenter = (): Handle => {
  const rt = cocoa();
  return rt.msgSend(
    rt.classes.get('NSUserNotificationCenter'),
    rt.selectors.get('defaultUserNotificationCenter'),
  );
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
  // `silent` suppresses the default sound. NSUserNotification plays a sound only
  // if `soundName` is set, so the default (no sound) already honours silent;
  // when NOT silent we opt into the default sound name.
  if (!spec.silent) {
    msgSendPtr(
      notification,
      rt.selectors.get('setSoundName:'),
      nsString('NSUserNotificationDefaultSoundName'),
    );
  }
  return notification;
};

/**
 * Build and (best-effort) deliver a notification. Never throws on the un-bundled
 * nil-center path; sending to a nil receiver is a no-op in Objective-C.
 */
const present = (spec: NotificationSpec): NotificationHandle => {
  const rt = cocoa();
  const notification = buildNotification(spec);
  const center = defaultCenter();
  if (center !== 0n) {
    msgSendPtr(center, rt.selectors.get('deliverNotification:'), notification);
  }
  return {
    close: () => {
      const c = defaultCenter();
      if (c !== 0n) {
        msgSendPtr(c, rt.selectors.get('removeDeliveredNotification:'), notification);
      }
    },
    // No center un-bundled means no delegate to fire a real close, so this is a
    // documented no-op on macOS (we do not pretend to wire it). The empty body
    // is `() => undefined` to satisfy Biome's noEmptyBlockStatements.
    onClosed: () => undefined,
  };
};

/**
 * Honest macOS support: `true` only when the default notification center is
 * non-nil (requires an app bundle). Un-bundled this returns `false`.
 */
const isSupported = (): boolean => {
  try {
    return defaultCenter() !== 0n;
  } catch {
    return false;
  }
};

/** The macOS native notification backend (NSUserNotification, un-bundled-aware). */
export const macosNotificationBackend: NotificationBackend = {
  isSupported,
  present,
};

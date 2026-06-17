import {
  distributedNotificationCenter,
  observeNotification,
  workspaceNotificationCenter,
} from './cocoa-notification-observer';

/**
 * macOS power + screen-lock events for `powerMonitor`.
 *
 * Sleep/wake are posted on the NSWorkspace notification center
 * (`NSWorkspaceWillSleepNotification` / `NSWorkspaceDidWakeNotification`); screen
 * lock/unlock are the (undocumented but stable, AppKit-wide) distributed
 * notifications `com.apple.screenIsLocked` / `com.apple.screenIsUnlocked`. All
 * four are wired through the shared notification observer (D034) and delivered on
 * the pumped run loop (D020/D021). Names are passed by value, mirroring the
 * appearance observer.
 */

const WILL_SLEEP = 'NSWorkspaceWillSleepNotification';
const DID_WAKE = 'NSWorkspaceDidWakeNotification';
const SCREEN_LOCKED = 'com.apple.screenIsLocked';
const SCREEN_UNLOCKED = 'com.apple.screenIsUnlocked';

/** The power-event handlers `powerMonitor` supplies. */
export type PowerEventHandlers = {
  readonly onSuspend: () => void;
  readonly onResume: () => void;
  readonly onLockScreen: () => void;
  readonly onUnlockScreen: () => void;
};

/** Register the four power/lock observers. Retained for the process lifetime. */
export const observePowerEvents = (handlers: PowerEventHandlers): void => {
  const workspace = workspaceNotificationCenter();
  observeNotification(workspace, WILL_SLEEP, handlers.onSuspend);
  observeNotification(workspace, DID_WAKE, handlers.onResume);
  const distributed = distributedNotificationCenter();
  observeNotification(distributed, SCREEN_LOCKED, handlers.onLockScreen);
  observeNotification(distributed, SCREEN_UNLOCKED, handlers.onUnlockScreen);
};

import {
  distributedNotificationCenter,
  observeNotification,
  workspaceNotificationCenter,
} from './cocoa-notification-observer';

// Screen lock/unlock use the undocumented but long-stable com.apple.screenIs(Un)locked names.

const WILL_SLEEP = 'NSWorkspaceWillSleepNotification';
const DID_WAKE = 'NSWorkspaceDidWakeNotification';
const SCREEN_LOCKED = 'com.apple.screenIsLocked';
const SCREEN_UNLOCKED = 'com.apple.screenIsUnlocked';

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

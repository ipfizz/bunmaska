import { nativeApp } from '../native-app';

/**
 * macOS desktop-integration operations behind Electron's `app`. Each delegates
 * to the native backend's optional `appKit`, present only on macOS; off macOS
 * they no-op / return falsy, matching Electron.
 */

/** macOS dock object (Electron's `app.dock`); `undefined` on other platforms. */
export type Dock = {
  /** An empty string clears the badge. */
  setBadge(text: string): void;
  getBadge(): string;
  /** `critical` bounces until the app is focused. */
  bounce(type?: 'critical' | 'informational'): void;
};

export const setActivationPolicy = (policy: 'regular' | 'accessory' | 'prohibited'): void => {
  nativeApp().appKit?.setActivationPolicy(policy);
};

export const hideApp = (): void => {
  nativeApp().appKit?.hide();
};

export const showApp = (): void => {
  nativeApp().appKit?.show();
};

/** Whether the application is hidden (macOS); `false` off macOS. */
export const isAppHidden = (): boolean => nativeApp().appKit?.isHidden() ?? false;

/** Whether the application is the active app (macOS); `false` off macOS. */
export const isAppActive = (): boolean => nativeApp().appKit?.isActive() ?? false;

export const showAboutPanel = (): void => {
  nativeApp().showAboutPanel?.();
};

export const getDock = (): Dock | undefined => {
  const appKit = nativeApp().appKit;
  if (appKit === undefined) {
    return undefined;
  }
  return {
    setBadge: (text) => appKit.setDockBadge(text),
    getBadge: () => appKit.getDockBadge(),
    bounce: (type) => appKit.bounceDock(type === 'critical'),
  };
};

/** Returns whether the badge was actually shown. */
export const displayBadgeCount = (count: number): boolean => {
  const appKit = nativeApp().appKit;
  if (appKit === undefined) {
    return false;
  }
  appKit.setDockBadge(count === 0 ? '' : String(count));
  return true;
};

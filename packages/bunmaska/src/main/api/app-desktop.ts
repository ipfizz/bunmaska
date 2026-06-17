import { nativeApp } from '../native-app';

/**
 * macOS desktop-integration operations behind Electron's `app` — activation
 * policy, hide/show, the dock object, badge display, and the about panel.
 *
 * Each delegates to the native backend's optional `appKit` (present only on
 * macOS); off macOS they no-op / return falsy, matching Electron (these are
 * macOS-only APIs). Kept out of `app.ts` so that class stays a thin facade.
 */

/** macOS dock object (Electron's `app.dock`); `undefined` on other platforms. */
export type Dock = {
  /** Set the dock badge text (empty string clears it). */
  setBadge(text: string): void;
  /** The current dock badge text. */
  getBadge(): string;
  /** Bounce the dock icon; `critical` bounces until the app is focused. */
  bounce(type?: 'critical' | 'informational'): void;
};

/** Set the macOS activation policy; no-op off macOS. */
export const setActivationPolicy = (policy: 'regular' | 'accessory' | 'prohibited'): void => {
  nativeApp().appKit?.setActivationPolicy(policy);
};

/** Hide all application windows (macOS); no-op off macOS. */
export const hideApp = (): void => {
  nativeApp().appKit?.hide();
};

/** Show application windows after a hide (macOS); no-op off macOS. */
export const showApp = (): void => {
  nativeApp().appKit?.show();
};

/** Whether the application is hidden (macOS); `false` off macOS. */
export const isAppHidden = (): boolean => nativeApp().appKit?.isHidden() ?? false;

/** Whether the application is the active app (macOS); `false` off macOS. */
export const isAppActive = (): boolean => nativeApp().appKit?.isActive() ?? false;

/** Show the platform's standard about panel; no-op where unsupported. */
export const showAboutPanel = (): void => {
  nativeApp().showAboutPanel?.();
};

/** The macOS dock object, or `undefined` on other platforms. */
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

/** Display `count` on the dock badge (macOS); returns whether it was shown. */
export const displayBadgeCount = (count: number): boolean => {
  const appKit = nativeApp().appKit;
  if (appKit === undefined) {
    return false;
  }
  appKit.setDockBadge(count === 0 ? '' : String(count));
  return true;
};

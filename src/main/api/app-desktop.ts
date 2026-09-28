import { nativeApp } from '../native-app';

/** Electron's `app.dock`; `undefined` off macOS. */
export type Dock = {
  /** An empty string clears the badge. */
  setBadge(text: string): void;
  getBadge(): string;
  /** `critical` bounces until the app is focused. */
  bounce(type?: 'critical' | 'informational'): void;
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

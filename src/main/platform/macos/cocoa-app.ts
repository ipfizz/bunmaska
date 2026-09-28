import { nsString, nsStringToString } from './cocoa-foundation';
import { msgSendI64, msgSendPtr, msgSendReturnsU8 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import type { Handle } from './objc';

/** Electron's activation-policy names as `NSApplicationActivationPolicy` values. */
const ACTIVATION_POLICY: Readonly<Record<string, bigint>> = {
  regular: 0n,
  accessory: 1n,
  prohibited: 2n,
};

/** `NSRequestUserAttentionType`: critical bounces until focused, informational once. */
const NS_CRITICAL_REQUEST = 0n;
const NS_INFORMATIONAL_REQUEST = 10n;

const nsApp = (): Handle => {
  const rt = cocoa();
  return rt.msgSend(rt.classes.get('NSApplication'), rt.selectors.get('sharedApplication'));
};

const dockTile = (): Handle => {
  const rt = cocoa();
  return rt.msgSend(nsApp(), rt.selectors.get('dockTile'));
};

export const setActivationPolicy = (policy: 'regular' | 'accessory' | 'prohibited'): void => {
  const rt = cocoa();
  msgSendI64(nsApp(), rt.selectors.get('setActivationPolicy:'), ACTIVATION_POLICY[policy] ?? 0n);
};

export const hide = (): void => {
  msgSendPtr(nsApp(), cocoa().selectors.get('hide:'), 0n);
};

export const show = (): void => {
  const rt = cocoa();
  msgSendPtr(nsApp(), rt.selectors.get('unhide:'), 0n);
};

export const isHidden = (): boolean =>
  msgSendReturnsU8(nsApp(), cocoa().selectors.get('isHidden')) === 1;

export const isActive = (): boolean =>
  msgSendReturnsU8(nsApp(), cocoa().selectors.get('isActive')) === 1;

/** Set the dock-tile badge label (empty string clears it). */
export const setDockBadge = (label: string): void => {
  msgSendPtr(dockTile(), cocoa().selectors.get('setBadgeLabel:'), nsString(label));
};

/** The current dock-tile badge label, or `''` when none is set. */
export const getDockBadge = (): string => {
  const label = cocoa().msgSend(dockTile(), cocoa().selectors.get('badgeLabel'));
  return label === 0n ? '' : nsStringToString(label);
};

/** Bounce the dock icon: `critical` bounces until focused, else once. */
export const bounceDock = (critical: boolean): void => {
  const rt = cocoa();
  msgSendI64(
    nsApp(),
    rt.selectors.get('requestUserAttention:'),
    critical ? NS_CRITICAL_REQUEST : NS_INFORMATIONAL_REQUEST,
  );
};

export const showAboutPanel = (): void => {
  msgSendPtr(nsApp(), cocoa().selectors.get('orderFrontStandardAboutPanel:'), 0n);
};

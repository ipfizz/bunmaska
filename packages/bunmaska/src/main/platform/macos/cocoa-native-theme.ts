import { nsString, nsStringToString } from './cocoa-foundation';
import { msgSendPtr, msgSendReturnsU8 } from './cocoa-msgsend-variants';
import { distributedNotificationCenter, observeNotification } from './cocoa-notification-observer';
import { cocoa } from './cocoa-runtime';

/**
 * macOS appearance query + change observer.
 *
 * Reads the `AppleInterfaceStyle` user default, which is the string `"Dark"`
 * when the system is in dark mode and absent (nil → `''`) otherwise. This is a
 * pure read with no UI or run-loop interaction.
 *
 * {@link observeAppearanceChange} subscribes to `AppleInterfaceThemeChangedNotification`
 * on `NSDistributedNotificationCenter` (via the shared notification observer,
 * D034) — the system-wide signal posted when the user toggles light/dark, which
 * is delivered on the pumped run loop (D020/D021).
 */

const APPLE_INTERFACE_STYLE = 'AppleInterfaceStyle';
const THEME_CHANGED_NOTIFICATION = 'AppleInterfaceThemeChangedNotification';

/** Apply an app-wide appearance override so web views re-theme (Electron `themeSource`). */
export const setAppearance = (source: 'system' | 'light' | 'dark'): void => {
  const rt = cocoa();
  const name =
    source === 'dark'
      ? 'NSAppearanceNameDarkAqua'
      : source === 'light'
        ? 'NSAppearanceNameAqua'
        : undefined;
  const appearance =
    name === undefined
      ? 0n
      : msgSendPtr(
          rt.classes.get('NSAppearance'),
          rt.selectors.get('appearanceNamed:'),
          nsString(name),
        );
  const nsApp = rt.msgSend(rt.classes.get('NSApplication'), rt.selectors.get('sharedApplication'));
  msgSendPtr(nsApp, rt.selectors.get('setAppearance:'), appearance);
};

/** Whether the system is currently using a dark appearance. */
export const shouldUseDarkColors = (): boolean => {
  const rt = cocoa();
  const defaults = rt.msgSend(
    rt.classes.get('NSUserDefaults'),
    rt.selectors.get('standardUserDefaults'),
  );
  const style = msgSendPtr(
    defaults,
    rt.selectors.get('stringForKey:'),
    nsString(APPLE_INTERFACE_STYLE),
  );
  return nsStringToString(style).toLowerCase() === 'dark';
};

/** Fire `onChange` whenever the system appearance flips (light↔dark). */
export const observeAppearanceChange = (onChange: () => void): void => {
  observeNotification(distributedNotificationCenter(), THEME_CHANGED_NOTIFICATION, onChange);
};

/** Whether the user has enabled "Reduce transparency" in Accessibility settings. */
export const prefersReducedTransparency = (): boolean => {
  const rt = cocoa();
  const workspace = rt.msgSend(rt.classes.get('NSWorkspace'), rt.selectors.get('sharedWorkspace'));
  return (
    msgSendReturnsU8(
      workspace,
      rt.selectors.get('accessibilityDisplayShouldReduceTransparency'),
    ) === 1
  );
};

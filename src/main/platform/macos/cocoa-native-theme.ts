import { nsString, nsStringToString } from './cocoa-foundation';
import { msgSendPtr } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';

/**
 * macOS appearance query.
 *
 * Reads the `AppleInterfaceStyle` user default, which is the string `"Dark"`
 * when the system is in dark mode and absent (nil → `''`) otherwise. This is a
 * pure read with no UI or run-loop interaction.
 */

const APPLE_INTERFACE_STYLE = 'AppleInterfaceStyle';

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

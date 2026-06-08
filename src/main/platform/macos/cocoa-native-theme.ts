import { nsString, nsStringToString } from './cocoa-foundation';
import { msgSendPtr, msgSendPtr4 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { Handle } from './objc';

/**
 * macOS appearance query + change observer.
 *
 * Reads the `AppleInterfaceStyle` user default, which is the string `"Dark"`
 * when the system is in dark mode and absent (nil → `''`) otherwise. This is a
 * pure read with no UI or run-loop interaction.
 *
 * {@link observeAppearanceChange} registers a `SambarThemeObserver` on
 * `NSDistributedNotificationCenter` for `AppleInterfaceThemeChangedNotification`,
 * the system-wide signal posted when the user toggles light/dark; the
 * notification is delivered on the pumped run loop (D020/D021).
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

// One shared observer class (defined once, D026); each registration owns an
// instance whose JS handler is looked up by the instance handle, mirroring the
// `cocoa-menu` click-registry pattern.
const themeChangeRegistry = new Map<Handle, () => void>();
const retainedObservers: Handle[] = [];
let themeObserverClass: Handle | undefined;

const ensureThemeObserverClass = (): Handle => {
  if (themeObserverClass !== undefined) {
    return themeObserverClass;
  }
  themeObserverClass = defineObjcClass('SambarThemeObserver', 'NSObject', [
    {
      selector: 'sambarAppearanceChanged:',
      typeEncoding: 'v@:@',
      args: ['object'],
      impl: (self) => {
        themeChangeRegistry.get(self)?.();
      },
    },
  ]);
  return themeObserverClass;
};

/**
 * Fire `onChange` whenever the system appearance flips (light↔dark). The
 * observer instance is retained for the process lifetime —
 * `NSDistributedNotificationCenter` does NOT retain its observers.
 */
export const observeAppearanceChange = (onChange: () => void): void => {
  const rt = cocoa();
  const cls = ensureThemeObserverClass();
  const observer = rt.msgSend(rt.msgSend(cls, rt.selectors.get('alloc')), rt.selectors.get('init'));
  themeChangeRegistry.set(observer, onChange);
  retainedObservers.push(observer);
  const center = rt.msgSend(
    rt.classes.get('NSDistributedNotificationCenter'),
    rt.selectors.get('defaultCenter'),
  );
  msgSendPtr4(
    center,
    rt.selectors.get('addObserver:selector:name:object:'),
    observer,
    rt.selectors.get('sambarAppearanceChanged:'),
    nsString(THEME_CHANGED_NOTIFICATION),
    0n,
  );
};

import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform, type Platform } from '../../common/platform';
import { gdkNativeImageBackend } from './linux/gdk-native-image';
import { gdkScreenBackend } from './linux/gdk-screen';
import { linuxClipboardBackend } from './linux/gtk-clipboard';
import { linuxDialogBackend } from './linux/gtk-dialog';
import { linuxMenuRealizer } from './linux/gtk-menu';
import * as gtkNativeTheme from './linux/gtk-native-theme';
import { linuxNotificationBackend } from './linux/gtk-notification';
import * as gtkShell from './linux/gtk-shell';
import { linuxLibsecretBackend } from './linux/libsecret-keyring';
import { createLinuxApplication } from './linux/linux-backend';
import { observePowerEvents as linuxObservePowerEvents } from './linux/linux-power-monitor';
import { linuxPowerSaveBlockerBackend } from './linux/linux-power-save-blocker';
import { linuxTrayBackend } from './linux/sni-tray';
import * as linuxCookies from './linux/webkit-cookies';
import { linuxGlobalShortcutBackend } from './linux/x11-global-shortcut';
import { macosGlobalShortcutBackend } from './macos/carbon-global-shortcut';
import { createMacOSApplication } from './macos/cocoa-backend';
import * as macosClipboard from './macos/cocoa-clipboard';
import * as macosCookies from './macos/cocoa-cookies';
import * as cocoaDialog from './macos/cocoa-dialog';
import * as cocoaMenu from './macos/cocoa-menu';
import { cocoaNativeImageBackend } from './macos/cocoa-native-image';
import * as cocoaNativeTheme from './macos/cocoa-native-theme';
import { macosNotificationBackend } from './macos/cocoa-notification';
import { observePowerEvents as macosObservePowerEvents } from './macos/cocoa-power';
import { cocoaPowerSaveBlockerBackend } from './macos/cocoa-power-save-blocker';
import { macosKeychainBackend } from './macos/cocoa-safe-storage';
import { cocoaScreenBackend } from './macos/cocoa-screen';
import * as cocoaShell from './macos/cocoa-shell';
import { macosTrayBackend } from './macos/cocoa-tray';
import { clearStorageData as macosClearStorageData } from './macos/cocoa-website-data';
import type { NativeApplication } from './native';
import type { PlatformServices } from './services';
import { createWindowsApplication } from './windows/windows-backend';
import { windowsClipboardBackend } from './windows/windows-clipboard';
import { windowsDialogBackend } from './windows/windows-dialog';
import { windowsGlobalShortcutBackend } from './windows/windows-global-shortcut';
import { windowsMenuRealizer } from './windows/windows-menu';
import { windowsNativeImageBackend } from './windows/windows-native-image';
import { windowsShouldUseDarkColors } from './windows/windows-native-theme';
import { windowsNotificationBackend } from './windows/windows-notification';
import { observePowerEvents as windowsObservePowerEvents } from './windows/windows-power-monitor';
import { windowsPowerSaveBlockerBackend } from './windows/windows-power-save-blocker';
import { windowsDpapiBackend } from './windows/windows-safe-storage';
import { windowsScreenBackend } from './windows/windows-screen';
import { windowsSessionBackend } from './windows/windows-session';
import { windowsShellBackend } from './windows/windows-shell';
import { windowsTrayBackend } from './windows/windows-tray';

/** Every backend's FFI loaders are lazy, so importing another OS's backend opens no library. */
export const createNativeApplication = (): NativeApplication => {
  const platform = currentPlatform();
  switch (platform) {
    case 'macos':
      return createMacOSApplication();
    case 'linux':
      return createLinuxApplication();
    case 'windows':
      return createWindowsApplication();
    default:
      throw new UnsupportedPlatformError(`No Bunmaska backend for platform: ${platform}`);
  }
};

/** The only place api/ reaches a concrete backend (D024); a new OS is one row. */
const SERVICES: Record<Platform, PlatformServices> = {
  macos: {
    clipboard: macosClipboard,
    dialog: cocoaDialog,
    globalShortcut: macosGlobalShortcutBackend,
    menu: {
      realize: cocoaMenu.realizeMenu,
      setApplicationMenu: (menu) => cocoaMenu.setApplicationMenu(menu ?? 0n),
    },
    nativeImage: cocoaNativeImageBackend,
    nativeTheme: {
      shouldUseDarkColors: cocoaNativeTheme.shouldUseDarkColors,
      prefersReducedTransparency: cocoaNativeTheme.prefersReducedTransparency,
      setThemeSource: cocoaNativeTheme.setAppearance,
      observe: cocoaNativeTheme.observeAppearanceChange,
    },
    notification: macosNotificationBackend,
    powerMonitor: macosObservePowerEvents,
    powerSaveBlocker: cocoaPowerSaveBlockerBackend,
    safeStorage: macosKeychainBackend,
    screen: cocoaScreenBackend,
    session: {
      clearStorageData: macosClearStorageData,
      getCookies: macosCookies.getCookies,
      setCookie: macosCookies.setCookie,
      removeCookie: macosCookies.removeCookie,
    },
    shell: cocoaShell,
    tray: macosTrayBackend,
  },
  linux: {
    clipboard: linuxClipboardBackend,
    dialog: linuxDialogBackend,
    globalShortcut: linuxGlobalShortcutBackend, // ponytail: X11 only; Wayland needs the GlobalShortcuts portal
    menu: linuxMenuRealizer,
    nativeImage: gdkNativeImageBackend,
    nativeTheme: {
      shouldUseDarkColors: gtkNativeTheme.shouldUseDarkColors,
      prefersReducedTransparency: () => false,
      setThemeSource: () => undefined,
      observe: gtkNativeTheme.observeAppearanceChange,
    },
    notification: linuxNotificationBackend,
    powerMonitor: linuxObservePowerEvents,
    powerSaveBlocker: linuxPowerSaveBlockerBackend,
    safeStorage: linuxLibsecretBackend,
    screen: gdkScreenBackend,
    session: {
      clearStorageData: () =>
        Promise.reject(
          new UnsupportedPlatformError('session.clearStorageData is not yet wired on Linux'),
        ), // ponytail: wire WebKitWebsiteDataManager clearing
      getCookies: linuxCookies.getCookies,
      setCookie: linuxCookies.setCookie,
      removeCookie: linuxCookies.removeCookie,
    },
    shell: gtkShell,
    tray: linuxTrayBackend,
  },
  windows: {
    clipboard: windowsClipboardBackend,
    dialog: windowsDialogBackend,
    globalShortcut: windowsGlobalShortcutBackend,
    menu: windowsMenuRealizer,
    nativeImage: windowsNativeImageBackend,
    nativeTheme: {
      shouldUseDarkColors: windowsShouldUseDarkColors,
      prefersReducedTransparency: () => false,
      setThemeSource: () => undefined,
      observe: () => undefined, // ponytail: no Windows appearance watcher
    },
    notification: windowsNotificationBackend,
    powerMonitor: windowsObservePowerEvents,
    powerSaveBlocker: windowsPowerSaveBlockerBackend,
    safeStorage: windowsDpapiBackend,
    screen: windowsScreenBackend,
    session: windowsSessionBackend,
    shell: windowsShellBackend,
    tray: windowsTrayBackend,
  },
};

/** The current OS's `key` service, resolved on every `get()`, with a test override. */
export const service = <K extends keyof PlatformServices>(
  key: K,
): {
  readonly get: () => PlatformServices[K];
  readonly setForTesting: (fake: PlatformServices[K] | undefined) => void;
} => {
  let override: PlatformServices[K] | undefined;
  return {
    get: () => override ?? SERVICES[currentPlatform()][key],
    setForTesting: (fake) => {
      override = fake;
    },
  };
};

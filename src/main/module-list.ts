/**
 * The canonical map of Electron's main-process module names and which ones
 * Sambar implements today (D028).
 *
 * This is the single source of truth for drop-in parity: the Phase-5 compat
 * suite checks against {@link KNOWN_ELECTRON_MODULES}, and consumers reaching
 * for an unimplemented name get the actionable {@link notImplementedMessage}
 * rather than a silent `undefined`.
 */

/**
 * Every main-process module `require('electron')` exposes, from Electron's
 * `lib/browser/api/module-list.ts`. Kept in sync deliberately, not generated,
 * so adding a name is a conscious parity decision.
 */
export const KNOWN_ELECTRON_MODULES = [
  'app',
  'autoUpdater',
  'BaseWindow',
  'BrowserView',
  'BrowserWindow',
  'clipboard',
  'contentTracing',
  'crashReporter',
  'desktopCapturer',
  'dialog',
  'globalShortcut',
  'ipcMain',
  'inAppPurchase',
  'Menu',
  'MenuItem',
  'MessageChannelMain',
  'nativeImage',
  'nativeTheme',
  'net',
  'netLog',
  'Notification',
  'powerMonitor',
  'powerSaveBlocker',
  'protocol',
  'pushNotifications',
  'safeStorage',
  'screen',
  'session',
  'shell',
  'systemPreferences',
  'TouchBar',
  'Tray',
  'utilityProcess',
  'webContents',
  'WebContents',
  'webFrameMain',
] as const;

export type ElectronModuleName = (typeof KNOWN_ELECTRON_MODULES)[number];

/** The modules Sambar actually ships. Grows phase by phase. */
export const IMPLEMENTED_MODULES = [
  'app',
  'BrowserWindow',
  'WebContents',
  'ipcMain',
  'clipboard',
  'dialog',
  'Menu',
  'MenuItem',
  'nativeTheme',
  'Notification',
  'shell',
] as const;

const implemented: ReadonlySet<string> = new Set(IMPLEMENTED_MODULES);

/** Whether Sambar implements the given module today. */
export const isImplemented = (name: string): boolean => implemented.has(name);

/** The actionable error message for a not-yet-implemented Electron module. */
export const notImplementedMessage = (name: string): string =>
  `Sambar: '${name}' is not yet implemented. Track progress at https://github.com/indrajeetor/sambar`;

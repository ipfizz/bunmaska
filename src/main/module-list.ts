/**
 * Every module `require('electron')` exposes in the main process (Electron's browser and
 * common `module-list.ts`, D028). Synced by hand: adding a name is a parity decision.
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
  'ImageView',
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
  'ServiceWorkerMain',
  'session',
  'sharedTexture',
  'ShareMenu',
  'shell',
  'systemPreferences',
  'TouchBar',
  'Tray',
  'utilityProcess',
  'View',
  'webContents',
  'WebContents',
  'WebContentsView',
  'webFrameMain',
] as const;

export type ElectronModuleName = (typeof KNOWN_ELECTRON_MODULES)[number];

export const IMPLEMENTED_MODULES = [
  'app',
  'autoUpdater',
  'BrowserWindow',
  'WebContents',
  'ipcMain',
  'clipboard',
  'dialog',
  'globalShortcut',
  'Menu',
  'MenuItem',
  'nativeImage',
  'nativeTheme',
  'Notification',
  'powerMonitor',
  'powerSaveBlocker',
  'protocol',
  'safeStorage',
  'screen',
  'session',
  'shell',
  'Tray',
] as const;

const implemented: ReadonlySet<string> = new Set(IMPLEMENTED_MODULES);

export const isImplemented = (name: string): boolean => implemented.has(name);

export const notImplementedMessage = (name: string): string =>
  `Bunmaska: '${name}' is not yet implemented. Track progress at https://github.com/ipfizz/bunmaska`;

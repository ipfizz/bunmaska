import './bootstrap';

export { App, app } from './api/app';
export type { Dock } from './api/app-desktop';
export {
  type AutoUpdater,
  type AutoUpdaterDeps,
  AutoUpdaterImpl,
  autoUpdater,
  type FeedURLOptions,
  type StagedUpdate,
  type UpdateCheckResult,
  type UpdateInfo,
} from './api/auto-updater';
export {
  BrowserWindow,
  type BrowserWindowOptions,
  type WebPreferences,
} from './api/browser-window';
export { type LoadFileOptions, WebContents } from './api/web-contents';
export { type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from './api/ipc-main';
export { clipboard, type Clipboard } from './api/clipboard';
export {
  dialog,
  type Dialog,
  type MessageBoxOptions,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from './api/dialog';
export { type GlobalShortcut, globalShortcut } from './api/global-shortcut';
export {
  Menu,
  MenuItem,
  type MenuItemClick,
  type MenuItemOptions,
  type MenuItemType,
  type MenuPopupOptions,
} from './api/menu';
export { NativeImage, nativeImage } from './api/native-image';
export { nativeTheme, type NativeTheme } from './api/native-theme';
export { Notification, type NotificationOptions } from './api/notification';
export { type PowerMonitor, powerMonitor } from './api/power-monitor';
export { type PowerSaveBlocker, powerSaveBlocker } from './api/power-save-blocker';
export {
  DEFAULT_MIME_TYPE,
  type ProtocolHandler,
  type ProtocolRequest,
  type ProtocolResponse,
  protocol,
} from './api/protocol';
export { type SafeStorage, safeStorage } from './api/safe-storage';
export { type Display, screen, type Size } from './api/screen';
export type { Cookie, CookieFilter, CookieSetDetails } from './api/cookie-util';
export { Cookies, Session, session } from './api/session';
export { shell, type Shell } from './api/shell';
export { Tray } from './api/tray';
export type { KeyboardInputEvent, MouseInputEvent, NativeInputEvent } from './platform/native';
export type { Point, TrayImageOptions } from './platform/services';
export {
  FFIError,
  InvalidArgumentError,
  BunmaskaError,
  type BunmaskaErrorOptions,
  UnsupportedPlatformError,
} from '../common/errors';
export { currentPlatform, isSupported, mapPlatform, type Platform } from '../common/platform';
export { BUNMASKA_VERSION } from '../common/version';
export type { Rect } from './platform/native';

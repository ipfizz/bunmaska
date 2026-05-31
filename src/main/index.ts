import './bootstrap';

export { App, app } from './api/app';
export { BrowserWindow, type BrowserWindowOptions } from './api/browser-window';
export { WebContents } from './api/web-contents';
export { ipcMain } from './api/ipc-main';
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
  type MenuItemOptions,
  type MenuItemType,
} from './api/menu';
export { nativeTheme, type NativeTheme } from './api/native-theme';
export { Notification, type NotificationOptions } from './api/notification';
export { type Display, type Point, screen, type Size } from './api/screen';
export { shell, type Shell } from './api/shell';
export {
  FFIError,
  InvalidArgumentError,
  SambarError,
  type SambarErrorOptions,
  UnsupportedPlatformError,
} from '../common/errors';
export { currentPlatform, isSupported, mapPlatform, type Platform } from '../common/platform';
export { SAMBAR_VERSION } from '../common/version';
export type { Rect } from './platform/native';

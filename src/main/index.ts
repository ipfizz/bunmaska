import './bootstrap';

export { App, app } from './api/app';
export { BrowserWindow, type BrowserWindowOptions } from './api/browser-window';
export { WebContents } from './api/web-contents';
export { clipboard, type Clipboard } from './api/clipboard';
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

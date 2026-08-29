import { EventEmitter } from 'node:events';
import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import { linuxNotificationBackend } from '../platform/linux/gtk-notification';
import { macosNotificationBackend } from '../platform/macos/cocoa-notification';
import { windowsNotificationBackend } from '../platform/windows/windows-notification';

/**
 * Native desktop notifications — the drop-in equivalent of Electron's
 * `Notification`. Events: `show`, emitted synchronously from
 * {@link Notification.show}, and `close`, which is BEST-EFFORT — macOS
 * un-bundled cannot wire it. `click` is deferred and deliberately not
 * advertised, so consumers do not rely on an event Bunmaska never delivers.
 */

export type NotificationOptions = {
  readonly title?: string;
  readonly body?: string;
  readonly subtitle?: string;
  readonly silent?: boolean;
};

export type NotificationSpec = {
  readonly title: string;
  readonly body: string;
  readonly subtitle: string;
  readonly silent: boolean;
};

export type NotificationHandle = {
  /** Safe to call more than once. */
  close(): void;
  /** Fired when the OS closes or the user dismisses it. */
  onClosed(callback: () => void): void;
};

export type NotificationBackend = {
  /** The HONEST per-platform answer to whether notifications can be delivered. */
  isSupported(): boolean;
  present(spec: NotificationSpec): NotificationHandle;
};

const macosBackend: NotificationBackend = macosNotificationBackend;
const linuxBackend: NotificationBackend = linuxNotificationBackend;

let backend: NotificationBackend | undefined;

const getBackend = (): NotificationBackend => {
  if (backend !== undefined) {
    return backend;
  }
  if (currentPlatform() === 'macos') {
    return macosBackend;
  }
  if (currentPlatform() === 'linux') {
    return linuxBackend;
  }
  if (currentPlatform() === 'windows') {
    return windowsNotificationBackend;
  }
  throw new UnsupportedPlatformError(`Notification is not supported on ${currentPlatform()} yet`);
};

/** @internal */
export const setNotificationBackendForTesting = (fake: NotificationBackend | undefined): void => {
  backend = fake;
};

export class Notification extends EventEmitter {
  /** The bold first line. */
  title: string;
  body: string;
  /** Secondary line under the title; macOS only, ignored elsewhere. */
  subtitle: string;
  /** Suppresses the notification sound. */
  silent: boolean;

  #handle: NotificationHandle | undefined;

  constructor(options: NotificationOptions = {}) {
    super();
    this.title = options.title ?? '';
    this.body = options.body ?? '';
    this.subtitle = options.subtitle ?? '';
    this.silent = options.silent ?? false;
  }

  /**
   * `false` on macOS un-bundled — the default notification center is nil without
   * an app bundle, so delivery needs packaging. Linux requires libnotify loaded
   * and `notify_init` succeeded.
   */
  static isSupported(): boolean {
    return getBackend().isSupported();
  }

  show(): void {
    const handle = getBackend().present({
      title: this.title,
      body: this.body,
      subtitle: this.subtitle,
      silent: this.silent,
    });
    this.#handle = handle;
    handle.onClosed(() => {
      this.emit('close');
    });
    this.emit('show');
  }

  /** Idempotent; a no-op when nothing is showing. */
  close(): void {
    const handle = this.#handle;
    if (handle === undefined) {
      return;
    }
    this.#handle = undefined;
    handle.close();
  }
}

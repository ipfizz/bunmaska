import { EventEmitter } from 'node:events';
import { selectBackend } from '../platform/index';
import { linuxNotificationBackend } from '../platform/linux/gtk-notification';
import { macosNotificationBackend } from '../platform/macos/cocoa-notification';
import { windowsNotificationBackend } from '../platform/windows/windows-notification';

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
  isSupported(): boolean;
  present(spec: NotificationSpec): NotificationHandle;
};

const macosBackend: NotificationBackend = macosNotificationBackend;
const linuxBackend: NotificationBackend = linuxNotificationBackend;

const { get: getBackend, setForTesting } = selectBackend<NotificationBackend>('Notification', {
  macos: () => macosBackend,
  linux: () => linuxBackend,
  windows: () => windowsNotificationBackend,
});

/** @internal */
export const setNotificationBackendForTesting = setForTesting;

/** Emits `show`, and `close` except on macOS, where it never fires. `click` is not delivered. */
export class Notification extends EventEmitter {
  title: string;
  body: string;
  /** Secondary line under the title; macOS only, ignored elsewhere. */
  subtitle: string;
  silent: boolean;

  #handle: NotificationHandle | undefined;

  constructor(options: NotificationOptions = {}) {
    super();
    this.title = options.title ?? '';
    this.body = options.body ?? '';
    this.subtitle = options.subtitle ?? '';
    this.silent = options.silent ?? false;
  }

  /** `false` on macOS without an app bundle (D30) and on Linux without libnotify. */
  static isSupported(): boolean {
    return getBackend().isSupported();
  }

  /** Dismisses a previously shown copy first, as Electron does. */
  show(): void {
    this.close();
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

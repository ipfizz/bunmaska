import { EventEmitter } from 'node:events';
import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import { linuxNotificationBackend } from '../platform/linux/gtk-notification';
import { macosNotificationBackend } from '../platform/macos/cocoa-notification';

/**
 * Native desktop notifications — the drop-in equivalent of Electron's
 * `Notification`.
 *
 * Extends Node's {@link EventEmitter} so the full listener API
 * (`on`/`once`/`addListener`/…) matches Electron's contract. Events:
 * - `show` — emitted synchronously from {@link Notification.show}.
 * - `close` — emitted when the OS reports the notification was dismissed/closed,
 *   IF the platform backend can wire it (Linux libnotify exposes a `closed`
 *   signal; macOS un-bundled cannot, so it is best-effort there).
 *
 * `click` (and other user-action events) are DEFERRED in v1: they require an OS
 * delegate/action wiring that is not yet implemented. They are intentionally not
 * advertised so consumers do not rely on events Bunmaska does not deliver.
 *
 * The native backend is injectable (mirrors `menu`/`dialog`/`shell`) so the
 * class's option-mapping, event wiring, and lifecycle are unit-testable with a
 * fake — no FFI required.
 */

export type NotificationOptions = {
  readonly title?: string;
  readonly body?: string;
  readonly subtitle?: string;
  readonly silent?: boolean;
};

/** The fields a backend needs to present one notification. */
export type NotificationSpec = {
  readonly title: string;
  readonly body: string;
  readonly subtitle: string;
  readonly silent: boolean;
};

/** A live, presented notification the API can close and observe. */
export type NotificationHandle = {
  /** Dismiss the notification. Safe to call more than once. */
  close(): void;
  /** Register a callback fired when the OS closes/dismisses the notification. */
  onClosed(callback: () => void): void;
};

/** The native backend the public `Notification` API delegates to. */
export type NotificationBackend = {
  /** The HONEST per-platform answer to whether notifications can be delivered. */
  isSupported(): boolean;
  /** Present a notification and return a handle to close/observe it. */
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
  throw new UnsupportedPlatformError(`Notification is not supported on ${currentPlatform()} yet`);
};

/** Override the native notification backend. Test-only. */
export const setNotificationBackendForTesting = (fake: NotificationBackend | undefined): void => {
  backend = fake;
};

export class Notification extends EventEmitter {
  /** Notification title (the bold first line). */
  title: string;
  /** Notification body text. */
  body: string;
  /** Secondary line shown under the title (macOS; ignored where unsupported). */
  subtitle: string;
  /** Whether to suppress the notification sound. */
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
   * Whether the host platform can actually deliver notifications. Honest:
   * - Linux: libnotify loaded and `notify_init` succeeded.
   * - macOS: `false` un-bundled (the default notification center is nil without
   *   an app bundle); reliable delivery needs packaging (a follow-up).
   */
  static isSupported(): boolean {
    return getBackend().isSupported();
  }

  /** Display the notification and emit `show`. */
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

  /** Dismiss the notification if it is showing. Idempotent. */
  close(): void {
    const handle = this.#handle;
    if (handle === undefined) {
      return;
    }
    this.#handle = undefined;
    handle.close();
  }
}

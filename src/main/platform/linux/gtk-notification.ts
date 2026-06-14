import { JSCallback, type Pointer } from 'bun:ffi';
import type {
  NotificationBackend,
  NotificationHandle,
  NotificationSpec,
} from '../../api/notification';
import { cstr } from '../cstr';
import { connectSignal } from './gtk-signals';
import { loadLibnotifyFFI } from './libnotify-ffi';

/**
 * Linux notifications via libnotify — the Linux half of Bunmaska's `Notification`.
 *
 * libnotify forwards to the session's notification daemon over D-Bus.
 * `notify_init('Bunmaska')` is called once per process before the first
 * notification. `notify_notification_new(title, body, NULL)` builds the
 * notification; `notify_notification_show(n, NULL)` displays it (returns FALSE if
 * there is no daemon — e.g. headless CI — which is expected and not an error);
 * `notify_notification_close(n, NULL)` dismisses it.
 *
 * The `NotifyNotification::closed` signal is wired via the existing
 * {@link connectSignal} (`g_signal_connect_data`) so the `Notification`'s `close`
 * event fires when the daemon/user dismisses it.
 *
 * JSCallback lifecycle (a past SIGSEGV class): the `closed` handler thunk MUST
 * stay reachable for the life of the connection — Bun GCs an unreferenced
 * {@link JSCallback}, and the daemon would then call into freed memory. Each live
 * notification therefore RETAINS its callback in the returned handle's closure,
 * and {@link JSCallback.close} is deferred to a later tick (never called
 * synchronously inside the handler's own invocation).
 */

/** ABI shape for `NotifyNotification::closed`: `(notification, user_data) -> void`. */
export const CLOSED_CB_DEF = { args: ['ptr', 'ptr'], returns: 'void' } as const;

/**
 * Every `closed`-signal {@link JSCallback} currently wired to a live
 * notification. Retained at module scope so Bun cannot GC the native thunk while
 * the daemon still holds its pointer (the SIGSEGV-avoidance retain). Each entry
 * is removed (and the callback closed on a later tick) when its notification
 * fires `closed` or is explicitly closed.
 */
const liveCallbacks = new Set<JSCallback>();

let initialized = false;

/** Ensure `notify_init('Bunmaska')` has run once. Returns whether init succeeded. */
const ensureInit = (): boolean => {
  const notify = loadLibnotifyFFI();
  if (initialized || notify.symbols.notify_is_initted() !== 0) {
    initialized = true;
    return true;
  }
  const ok = notify.symbols.notify_init(cstr('Bunmaska')) !== 0;
  initialized = ok;
  return ok;
};

const present = (spec: NotificationSpec): NotificationHandle => {
  const notify = loadLibnotifyFFI();
  ensureInit();

  const notification = notify.symbols.notify_notification_new(
    cstr(spec.title),
    cstr(spec.body),
    // `cstring` cannot be null via the FFI binding, so an empty icon name (no
    // icon) is passed instead of NULL — equivalent for our purposes.
    cstr(''),
  );
  if (notification === null) {
    throw new Error('notify_notification_new() returned null');
  }

  // No daemon (headless CI) makes show return FALSE — expected, not an error.
  notify.symbols.notify_notification_show(notification, null);

  return {
    close: () => {
      notify.symbols.notify_notification_close(notification, null);
    },
    // Wire the daemon's `closed` signal to `cb`. The thunk is retained in
    // `liveCallbacks` until it fires; it is closed on a LATER tick (never
    // synchronously inside its own invocation — that would free the trampoline
    // the daemon is about to return into).
    onClosed: (cb) => {
      const callback = new JSCallback((_notification: Pointer, _userData: Pointer): void => {
        cb();
        setTimeout(() => {
          liveCallbacks.delete(callback);
          callback.close();
        }, 0);
      }, CLOSED_CB_DEF);
      liveCallbacks.add(callback);
      connectSignal(notification, 'closed', callback);
    },
  };
};

const isSupported = (): boolean => {
  try {
    return ensureInit();
  } catch {
    return false;
  }
};

/** The Linux native notification backend (libnotify). */
export const linuxNotificationBackend: NotificationBackend = {
  isSupported,
  present,
};

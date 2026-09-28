import { JSCallback } from 'bun:ffi';
import type {
  NotificationBackend,
  NotificationHandle,
  NotificationSpec,
} from '../../api/notification';
import { cstr } from '../cstr';
import { loadGlibFFI } from './glib-ffi';
import { loadGObjectFFI } from './gobject-ffi';
import { connectSignal, deferCallbackClose } from './gtk-signals';
import { loadLibnotifyFFI } from './libnotify-ffi';

/** `NotifyNotification::closed`: `(notification, user_data) -> void`. */
const CLOSED_CB_DEF = { args: ['ptr', 'ptr'], returns: 'void' } as const;

/** Keeps each `closed` thunk reachable until it fires; closed on a later tick (`deferCallbackClose`). */
const liveCallbacks = new Set<JSCallback>();

let initialized = false;

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

// ponytail: libnotify's show/close are 25 s sync D-Bus calls; send Notify via linux-dbus callMethodSync (5 s bound) if a wedged daemon matters.
const present = (spec: NotificationSpec): NotificationHandle => {
  const notify = loadLibnotifyFFI();
  const gobject = loadGObjectFFI().symbols;
  ensureInit();

  const notification = notify.symbols.notify_notification_new(
    cstr(spec.title),
    cstr(spec.body),
    null,
  );
  if (notification === null) {
    throw new Error('notify_notification_new() returned null');
  }
  if (spec.silent) {
    // set_hint sinks the floating GVariant.
    notify.symbols.notify_notification_set_hint(
      notification,
      cstr('suppress-sound'),
      loadGlibFFI().symbols.g_variant_new_boolean(1),
    );
  }

  // No daemon (headless CI) makes show return FALSE and `closed` never fires, so release now.
  if (notify.symbols.notify_notification_show(notification, null) === 0) {
    gobject.g_object_unref(notification);
    return { close: () => undefined, onClosed: () => undefined };
  }

  let onClosed: (() => void) | undefined;
  let open = true;
  const callback = new JSCallback((): void => {
    open = false;
    liveCallbacks.delete(callback);
    gobject.g_signal_handler_disconnect(notification, connection.handlerId);
    deferCallbackClose([callback, { close: () => gobject.g_object_unref(notification) }]);
    onClosed?.();
  }, CLOSED_CB_DEF);
  liveCallbacks.add(callback);
  const connection = connectSignal(notification, 'closed', callback);

  return {
    close: () => {
      if (open) {
        notify.symbols.notify_notification_close(notification, null);
      }
    },
    onClosed: (cb) => {
      onClosed = cb;
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

/** The libnotify notification backend. */
export const linuxNotificationBackend: NotificationBackend = {
  isSupported,
  present,
};

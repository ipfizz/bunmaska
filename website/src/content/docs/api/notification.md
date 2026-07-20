---
title: "Notification"
description: "Create native OS desktop notifications from the main process on macOS, Linux, and Windows."
order: 12
---

Create native OS desktop notifications. `Notification` extends Node's `EventEmitter`, so the full listener API (`on`/`once`/`addListener`/…) matches Electron's contract. It is a main-process module backed by Cocoa's `NSUserNotification` on macOS, libnotify on Linux, and a `Shell_NotifyIcon` balloon toast on Windows. Like Electron, instantiating a notification does not show it - you call `show()` for that.

Process: Main

## Methods

### `notification.show()`

`show(): void`

Displays the notification and synchronously emits the `show` event. As in Electron, constructing a `Notification` does not display anything; you must call `show()`. Calling it again re-presents the notification.

```ts
import { Notification } from 'bunmaska';

const n = new Notification({
  title: 'Build finished',
  body: 'Your bundle is ready.',
});

n.show();
```

### `notification.close()`

`close(): void`

Dismisses the notification if it is currently showing. Idempotent - calling it when nothing is shown (or calling it twice) is a no-op and will not throw.

```ts
import { Notification } from 'bunmaska';

const n = new Notification({ title: 'Heads up', body: 'Auto-dismissing in 5s.' });
n.show();

setTimeout(() => n.close(), 5000);
```

## Events

### Event: 'show'

Emitted synchronously when `show()` is called. As in Electron, this can fire multiple times since `show()` can be called repeatedly.

```ts
import { Notification } from 'bunmaska';

const n = new Notification({ title: 'Hello', body: 'World' });
n.on('show', () => console.log('notification shown'));
n.show();
```

### Event: 'close'

Emitted when the OS reports that the notification was dismissed or closed.

Honest platform caveat:

- _Linux_ - fully wired. The `NotifyNotification::closed` signal from the notification daemon is connected to this event, so `close` fires when the user (or the system) dismisses the notification.
- _macOS_ - best-effort only. The un-bundled `NSUserNotification` path has no delegate to report a real close, so the handle's `onClosed` is a no-op; do not rely on `close` firing on macOS in the current version.

```ts
import { Notification } from 'bunmaska';

const n = new Notification({ title: 'Job', body: 'Running…' });
n.on('close', () => console.log('notification closed by the user/OS'));
n.show();
```

## Properties

All four properties are plain mutable instance fields set from the constructor options (defaulting to `''` for strings and `false` for `silent`). Note that, unlike Electron, mutating a property after `show()` does not update an already-presented notification - set them before calling `show()`.

### `notification.title`

`title: string`

The bold first line of the notification. Defaults to `''`.

### `notification.body`

`body: string`

The body text shown under the title. Defaults to `''`.

### `notification.subtitle` _macOS_

`subtitle: string`

A secondary line shown under the title. Wired only on macOS (mapped to `NSUserNotification`'s `setSubtitle:`); the field exists on every platform but is ignored by the Linux backend. Defaults to `''`.

### `notification.silent`

`silent: boolean`

Whether to suppress the notification sound. Works on macOS and Linux. Defaults to `false`. (On macOS, `silent: false` opts into the default sound name, since `NSUserNotification` is otherwise silent.)

```ts
import { Notification } from 'bunmaska';

const n = new Notification();
n.title = 'Deploy complete';
n.subtitle = 'production'; // macOS only
n.body = 'All services are green.';
n.silent = true;
n.show();
```

## Static methods

### `Notification.isSupported()`

`static isSupported(): boolean`

Returns whether the host platform can actually deliver notifications. This is the honest answer, not a hardcoded `true`:

- _Linux_ - `true` once libnotify is loaded and `notify_init` succeeded.
- _macOS_ - `false` when run un-bundled, because the default notification center is `nil` without an app bundle. Reliable macOS delivery needs packaging (a follow-up).
- _Windows_ - `true`; notifications are delivered as a `Shell_NotifyIcon` balloon toast.

```ts
import { Notification } from 'bunmaska';

if (Notification.isSupported()) {
  new Notification({ title: 'Ready', body: 'Notifications are available.' }).show();
} else {
  console.log('Desktop notifications are not available on this host.');
}
```

## Not in Bunmaska (yet)

Bunmaska implements a deliberately small, honest subset. The following Electron `Notification` members are not present in the current source:

- **User-interaction events** - `click`, `reply`, and `action` are deferred in v1. They require OS delegate/action wiring (an `NSUserNotificationCenterDelegate` on macOS, action capabilities on Linux) that is not yet implemented, so they are intentionally not advertised. The `failed` event is also not emitted.
- **Constructor options** - only `title`, `body`, `subtitle`, and `silent` are supported. `icon`, `hasReply`, `replyPlaceholder`, `sound`, `urgency`, `timeoutType`, `actions`, `closeButtonText`, `id`, `groupId`, `groupTitle`, and `toastXml` are not implemented.
- **Properties** - correspondingly, there are no `icon`, `hasReply`, `replyPlaceholder`, `sound`, `urgency`, `timeoutType`, `actions`, `closeButtonText`, `id`, `groupId`, or `groupTitle` properties.
- **Static methods** - `Notification.getHistory()`, `Notification.remove()`, `Notification.removeAll()`, and `Notification.removeGroup()` (all macOS in Electron) are not implemented. `Notification.handleActivation()` is Windows-only in Electron and out of scope here.
- **Windows rich toasts** - Windows delivers a basic `Shell_NotifyIcon` balloon toast (`isSupported()` is `true`). Rich Action Center toasts (buttons, images, inline replies) and a registered AppUserModelID are a follow-up, so the same interaction-event and constructor-option gaps above apply on Windows too.

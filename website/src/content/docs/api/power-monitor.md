---
title: "powerMonitor"
description: "Monitor system sleep/wake and screen lock/unlock events in the Bunmaska main process."
order: 19
---

Process: Main

`powerMonitor` lets the main process observe system power-state transitions - when the machine suspends or resumes, and when the screen is locked or unlocked. In Bunmaska it is an `EventEmitter` that wires native observers on macOS (NSWorkspace sleep/wake plus the distributed screen-lock notifications), Linux (systemd-logind's `PrepareForSleep` and session `Lock`/`Unlock` D-Bus signals), and Windows (`WM_POWERBROADCAST` for suspend/resume and `WM_WTSSESSION_CHANGE` for lock/unlock). It is an event-only module today: the idle-time and battery query surface from Electron is not here yet (see below).

The observers attach once at startup. You import the singleton and listen - no construction, no `startObserving()` call from app code (the bootstrap does that for you).

## Events

The `powerMonitor` module emits the following events. All four are wired on macOS, Linux, and Windows.

### Event: 'suspend'

Emitted when the system is about to suspend (sleep).

On macOS this is `NSWorkspaceWillSleepNotification`; on Linux it is logind's `PrepareForSleep(true)` on the system bus; on Windows it is `WM_POWERBROADCAST` (`PBT_APMSUSPEND`).

```ts
import { powerMonitor } from 'bunmaska';

powerMonitor.on('suspend', () => {
  console.log('The system is going to sleep - flush state now.');
});
```

### Event: 'resume'

Emitted when the system resumes from suspend.

On macOS this is `NSWorkspaceDidWakeNotification`; on Linux it is logind's `PrepareForSleep(false)`; on Windows it is `WM_POWERBROADCAST` (`PBT_APMRESUMESUSPEND`).

```ts
import { powerMonitor } from 'bunmaska';

powerMonitor.on('resume', () => {
  console.log('Welcome back - reconnect sockets, re-validate sessions.');
});
```

### Event: 'lock-screen'

Emitted when the system locks the screen.

On macOS this is the (undocumented but stable, AppKit-wide) distributed notification `com.apple.screenIsLocked`. On Linux it is the session `Lock` signal from logind. On Windows it is `WM_WTSSESSION_CHANGE` (`WTS_SESSION_LOCK`).

```ts
import { powerMonitor } from 'bunmaska';

powerMonitor.on('lock-screen', () => {
  console.log('Screen locked - pause anything sensitive.');
});
```

A note on the Linux coarseness (these mirror logind's own limits, not Bunmaska bugs): the event only fires when something actually drives the session's logind `Lock` method (e.g. `loginctl lock-session`). A bare `i3lock`/`xscreensaver` that does not integrate with logind will not trigger it. On multi-seat / fast-user-switching systems another session's lock can fire yours, since Bunmaska matches the signal on any session path.

### Event: 'unlock-screen'

Emitted when the system unlocks the screen.

On macOS this is `com.apple.screenIsUnlocked`; on Linux it is the session `Unlock` signal; on Windows it is `WM_WTSSESSION_CHANGE` (`WTS_SESSION_UNLOCK`). The same Linux caveats as `lock-screen` apply.

```ts
import { powerMonitor } from 'bunmaska';

powerMonitor.on('unlock-screen', () => {
  console.log('Screen unlocked.');
});
```

## Methods

`powerMonitor` is a standard `EventEmitter`, so the usual instance methods (`on`, `once`, `off`/`removeListener`, `removeAllListeners`, `emit`, ...) are available. Beyond those, the only Bunmaska-specific method is:

### `powerMonitor.startObserving([observe])`

Begins emitting power events by attaching the native observers. This is idempotent - only the first call wires anything; later calls are a no-op. The bootstrap calls this once at startup, so application code normally does not need to. The optional `observe` argument is an injection seam for unit tests and is not part of normal usage.

```ts
import { powerMonitor } from 'bunmaska';

// Normally unnecessary - the runtime calls this for you at startup.
powerMonitor.startObserving();
```

> Note: there is also a `resetObservingForTesting()` method. As the name promises, it exists for tests only - do not rely on it in app code.

## Not in Bunmaska (yet)

Bunmaska's `powerMonitor` currently covers sleep/wake and screen lock/unlock. The rest of Electron's surface for this module is not implemented:

- **`getSystemIdleState(idleThreshold)`** and **`getSystemIdleTime()`** - idle-state/idle-time queries. Unimplemented on all platforms (not Windows-specific); the source flags IOKit/UPower idle queries as a separate follow-up.
- **`isOnBatteryPower()`** and the **`onBatteryPower`** property - battery vs. AC power state. Unimplemented on all platforms; same follow-up.
- **`'on-ac'` / `'on-battery'` events** - power-source transitions. Not emitted (they depend on the battery surface above).
- **`getCurrentThermalState()` and the `'thermal-state-change'` event** (macOS) - thermal management state. Not implemented.
- **`'speed-limit-change'` event** - OS-advertised CPU speed limit. Not implemented.
- **`'shutdown'` event** (Linux/macOS) - system reboot/shutdown with `preventDefault()` to delay it. Not implemented.
- **`'user-did-become-active'` / `'user-did-resign-active'` events** (macOS) - login-session activation. Not implemented.

Windows emits `suspend`/`resume` and `lock-screen`/`unlock-screen` like the other platforms; the unimplemented members above are missing on every platform, not Windows-specific.

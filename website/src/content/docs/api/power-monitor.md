---
title: "powerMonitor"
description: "Monitor system sleep/wake and screen lock/unlock events in the Bunmaska main process."
order: 19
---

Process: Main

`powerMonitor` lets the main process observe system power-state transitions - when the machine suspends or resumes, when the screen is locked or unlocked, and when the machine switches between AC and battery. It also answers idle-time and battery queries. In Bunmaska it is an `EventEmitter` that wires native observers on macOS (NSWorkspace sleep/wake plus the distributed screen-lock notifications, CoreGraphics idle time, IOKit power source), Linux (systemd-logind's `PrepareForSleep` and session `Lock`/`Unlock` D-Bus signals, sysfs battery), and Windows (`WM_POWERBROADCAST` for suspend/resume/power-source and `WM_WTSSESSION_CHANGE` for lock/unlock, `GetLastInputInfo` idle time).

The observers attach once at startup. You import the singleton and listen - no construction, no `startObserving()` call from app code (the bootstrap does that for you).

## Events

The `powerMonitor` module emits the following events. Sleep and lock events are wired on macOS, Linux, and Windows. On Linux those four need `BUNMASKA_ENABLE_LINUX_POWER=1` and a system bus with logind; `on-ac` / `on-battery` come from sysfs and do not need the switch.

### Event: 'suspend'

Emitted when the system is about to suspend (sleep).

On macOS this is `NSWorkspaceWillSleepNotification`; on Linux it is logind's `PrepareForSleep(true)` on the system bus; on Windows it is `WM_POWERBROADCAST` (`PBT_APMSUSPEND`).

On Linux this is best-effort: Bunmaska takes no logind delay inhibitor, so the machine may already be asleep by the time the signal is handled, and the event can arrive after wake. Don't count on it to finish work before the lid closes.

```ts
import { powerMonitor } from 'bunmaska';

powerMonitor.on('suspend', () => {
  console.log('The system is going to sleep - flush state now.');
});
```

### Event: 'resume'

Emitted when the system resumes from suspend.

On macOS this is `NSWorkspaceDidWakeNotification`; on Linux it is logind's `PrepareForSleep(false)`; on Windows it is `WM_POWERBROADCAST` (`PBT_APMRESUMEAUTOMATIC`, so it fires once per wake, as in Chromium).

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

### Event: 'on-ac'

Emitted when the machine starts running on AC power. On Windows this is `PBT_APMPOWERSTATUSCHANGE`. On macOS and Linux Bunmaska polls the power source every two seconds and emits only on a change (not the initial snapshot).

### Event: 'on-battery'

Emitted when the machine starts running on battery. Same sources as `'on-ac'`.

```ts
import { powerMonitor } from 'bunmaska';

powerMonitor.on('on-battery', () => {
  console.log('Unplugged - pause heavy work.');
});
```

## Methods

`powerMonitor` is a standard `EventEmitter`, so the usual instance methods (`on`, `once`, `off`/`removeListener`, `removeAllListeners`, `emit`, ...) are available.

### `powerMonitor.getSystemIdleTime()`

Returns `number` - seconds since the last user input. `0` if the backend cannot tell.

- **macOS:** `CGEventSourceSecondsSinceLastEventType`.
- **Windows:** `GetLastInputInfo` against `GetTickCount`.
- **Linux:** always `0`. There is no portable HID idle source Bunmaska can read without extra desktop services. `getSystemIdleState` still reports `'locked'` while the session is locked through logind.

### `powerMonitor.getSystemIdleState(idleThreshold)`

* `idleThreshold` number - seconds. A non-finite or negative value returns `'unknown'`.

Returns `'active' | 'idle' | 'locked' | 'unknown'`. Lock wins; otherwise idle time is compared to the threshold, as in Electron.

### `powerMonitor.isOnBatteryPower()`

Returns `boolean` - whether the machine is on battery. Also available as the `onBatteryPower` getter.

- **macOS:** IOKit `IOPSGetProvidingPowerSourceType` (`Battery Power`).
- **Windows:** `GetSystemPowerStatus` (`ACLineStatus === 0`).
- **Linux:** sysfs `/sys/class/power_supply` (AC/USB offline and a battery discharging). No switch required.

```ts
import { powerMonitor } from 'bunmaska';

if (powerMonitor.isOnBatteryPower()) {
  console.log('on battery', powerMonitor.getSystemIdleTime());
}
```

Beyond those, the bootstrap-only method is:

### `powerMonitor.startObserving([observe])`

Begins emitting power events by attaching the native observers. This is idempotent - only the first call wires anything; later calls are a no-op. The bootstrap calls this once at startup, so application code normally does not need to. The optional `observe` argument is an injection seam for unit tests and is not part of normal usage.

```ts
import { powerMonitor } from 'bunmaska';

// Normally unnecessary - the runtime calls this for you at startup.
powerMonitor.startObserving();
```

> Note: there is also a `resetObservingForTesting()` method. As the name promises, it exists for tests only - do not rely on it in app code.

## Not in Bunmaska (yet)

Bunmaska's `powerMonitor` covers sleep/wake, lock/unlock, idle queries, and AC/battery. Still missing from Electron's surface:

- **`getSystemIdleTime()` on Linux** - always `0` (no portable HID idle source). `getSystemIdleState` still reports `'locked'`.
- **`getCurrentThermalState()` and the `'thermal-state-change'` event** (macOS) - thermal management state. Not implemented.
- **`'speed-limit-change'` event** - OS-advertised CPU speed limit. Not implemented.
- **`'shutdown'` event** (Linux/macOS) - system reboot/shutdown with `preventDefault()` to delay it. Not implemented.
- **`'user-did-become-active'` / `'user-did-resign-active'` events** (macOS) - login-session activation. Not implemented.

Windows emits the same sleep, lock and power-source events as the other platforms. Thermal and shutdown events are missing everywhere, not Windows-specific.

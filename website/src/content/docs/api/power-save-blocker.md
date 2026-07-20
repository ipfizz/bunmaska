---
title: "powerSaveBlocker"
description: "Block the system from entering low-power (sleep) mode in the Bunmaska main process."
order: 20
---

Process: Main

The `powerSaveBlocker` module blocks the system (and optionally the display) from entering low-power sleep - for downloads, audio, or video playback. In Bunmaska it is a start/stop registry: `start()` asks the platform backend for a native blocker, files it under a fresh incrementing id, and hands you that id; `stop()` releases the native handle and forgets the id.

Backends are real: macOS holds an IOKit `IOPMAssertion` (synchronous, no run loop needed), Linux holds an `org.freedesktop.ScreenSaver` inhibition cookie over D-Bus, and Windows calls `SetThreadExecutionState` (both `prevent-app-suspension` and `prevent-display-sleep` map to real flags). The module-level API surface matches Electron's exactly - there are no events or properties on this module, so what you see below is the whole thing.

```ts
import { powerSaveBlocker } from 'bunmaska';

const id = powerSaveBlocker.start('prevent-display-sleep');
console.log(powerSaveBlocker.isStarted(id)); // true

// ...later...
powerSaveBlocker.stop(id);
```

## Methods

### `powerSaveBlocker.start(type)`

* `type` string - Power save blocker type.
  * `prevent-app-suspension` - Prevent the application from being suspended. Keeps the system active but allows the screen to turn off. Example use cases: downloading a file, playing audio.
  * `prevent-display-sleep` - Prevent the display from going to sleep. Keeps both system and screen active. Example use case: playing video.

Returns `number` - The blocker id assigned to this power save blocker.

Starts preventing the system from entering low-power mode. Ids are unique for the process lifetime and never reused.

Like Electron, `start()` **always** returns a real id, even when no native mechanism is available - for example on headless CI, or on Linux when the gate is off (see below). In that case the block is simply a documented no-op: `isStarted` still reports `true`, `stop` still returns `true`, and there is nothing native to release. Callers never get `-1`.

On macOS, `prevent-display-sleep` maps to `PreventUserIdleDisplaySleep` and `prevent-app-suspension` to `PreventUserIdleSystemSleep`; display-sleep prevention also keeps the system awake, matching Electron's documented precedence.

On _Linux_, both types currently map to the same `org.freedesktop.ScreenSaver` idle inhibition. This blocks idle-triggered sleep but is slightly less authoritative than logind's `Inhibit(what='sleep')` path (which would also block lid-close/explicit sleep). The Linux backend is gated behind the `BUNMASKA_ENABLE_LINUX_POWER_BLOCKER` environment variable and is a clean no-op when there is no session bus.

```ts
import { powerSaveBlocker } from 'bunmaska';

let blockerId: number | undefined;

function startDownload() {
  // Keep the machine awake, but let the screen sleep.
  blockerId = powerSaveBlocker.start('prevent-app-suspension');
}

function downloadFinished() {
  if (blockerId !== undefined) {
    powerSaveBlocker.stop(blockerId);
    blockerId = undefined;
  }
}
```

### `powerSaveBlocker.stop(id)`

* `id` number - The blocker id returned by `powerSaveBlocker.start`.

Returns `boolean` - `true` if `id` referred to a live blocker (now stopped and its native handle released), `false` for an unknown or already-stopped id.

Native release is best-effort: it never throws, and the id is forgotten regardless.

```ts
import { powerSaveBlocker } from 'bunmaska';

const id = powerSaveBlocker.start('prevent-display-sleep');

const wasStopped = powerSaveBlocker.stop(id);
console.log(wasStopped);               // true
console.log(powerSaveBlocker.stop(id)); // false - already stopped
```

### `powerSaveBlocker.isStarted(id)`

* `id` number - The blocker id returned by `powerSaveBlocker.start`.

Returns `boolean` - Whether the blocker with `id` is currently started.

```ts
import { powerSaveBlocker } from 'bunmaska';

const id = powerSaveBlocker.start('prevent-app-suspension');
console.log(powerSaveBlocker.isStarted(id)); // true

powerSaveBlocker.stop(id);
console.log(powerSaveBlocker.isStarted(id)); // false
console.log(powerSaveBlocker.isStarted(9999)); // false - unknown id
```

## Not in Bunmaska (yet)

Electron's `powerSaveBlocker` module is exactly three methods - `start`, `stop`, and `isStarted` - with no events or properties. Bunmaska implements all three, so the public surface is fully covered.

A few honest caveats on behavior rather than missing members:

- **Linux is gated and coarse.** The Linux backend only runs when `BUNMASKA_ENABLE_LINUX_POWER_BLOCKER` is set and a session bus is present; otherwise `start()` returns a valid id but does nothing. Both blocker types collapse to the same `org.freedesktop.ScreenSaver` idle inhibition, so `prevent-app-suspension` and `prevent-display-sleep` are not yet distinguished on Linux, and lid-close/explicit sleep are not blocked (the logind fd path is a future upgrade).
- **No-mechanism platforms are no-ops.** On any platform without a wired backend (or headless CI), the registry still hands out ids and tracks them, but no native assertion is taken. This matches Electron's "always returns an integer" contract, just without the real-world effect.
- **Windows is fully supported.** The Windows backend uses `SetThreadExecutionState`, with both `prevent-app-suspension` and `prevent-display-sleep` mapped to real execution-state flags.

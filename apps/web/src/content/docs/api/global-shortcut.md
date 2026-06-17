---
title: "globalShortcut"
description: "Register OS-level keyboard shortcuts that fire even when your app does not have focus - macOS (Carbon) and Linux X11."
order: 15
---

Detect keyboard events when the application does not have keyboard focus.

Process: Main

The `globalShortcut` module registers and unregisters system-wide keyboard shortcuts with the operating system, so a key combination can trigger your app even when it is not focused. Bunmaska's implementation parses and validates accelerators in pure TypeScript, tracks which ones are live, and delegates the actual OS grab to a per-platform backend: Carbon on macOS, Xlib `XGrabKey` on Linux. There is no FFI tax for the bookkeeping - only the grab itself touches native code.

```ts
import { app, globalShortcut } from 'bunmaska';

app.whenReady().then(() => {
  const ok = globalShortcut.register('CmdOrCtrl+Shift+K', () => {
    console.log('CmdOrCtrl+Shift+K was pressed');
  });

  if (!ok) {
    console.log('registration failed (taken, unparseable, or platform unsupported)');
  }

  console.log(globalShortcut.isRegistered('CmdOrCtrl+Shift+K')); // true
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
```

Accelerator strings are the familiar Electron shape - zero or more modifier tokens and exactly one final key, joined by `+`. Supported modifiers include `CmdOrCtrl` (Command on macOS, Control on Linux), `Shift`, `Alt`, `Ctrl`, `Command`/`Cmd`, and `Super`. An unparseable accelerator does not throw; `register` simply returns `false`.

> Platform reality check. macOS registration works even for an un-bundled process via Carbon. Linux is **best-effort under X11 only**: `XGrabKey` governs the X server, so under a Wayland compositor (even via XWayland) a global grab does not see keys routed to native Wayland clients. On Wayland the backend reports unsupported and `register` returns `false` rather than pretending. True Wayland global shortcuts need the `org.freedesktop.portal.GlobalShortcuts` portal, which is deferred.

## Methods

### `globalShortcut.register(accelerator, callback)`

* `accelerator` string - An accelerator shortcut.
* `callback` Function - Called when the shortcut fires.

Returns `boolean` - Whether the shortcut was registered successfully.

Registers a global shortcut. Returns `false` without touching the OS if the accelerator is unparseable or already registered by this app, and `false` if the OS refuses the grab (for example, when another application already owns it - operating systems intentionally don't let apps fight over global shortcuts).

```ts
import { app, globalShortcut } from 'bunmaska';

app.whenReady().then(() => {
  const ok = globalShortcut.register('CmdOrCtrl+Alt+P', () => {
    console.log('quick capture');
  });
  if (!ok) console.log('could not claim CmdOrCtrl+Alt+P');
});
```

### `globalShortcut.registerAll(accelerators, callback)`

* `accelerators` string[] - An array of accelerator shortcuts.
* `callback` Function - Called when any of the registered shortcuts fires.

Registers every accelerator in the array against one shared callback. Unparseable or already-taken entries are silently skipped.

Note: unlike Electron, Bunmaska's `registerAll` returns `void` - it does not report a boolean for the batch. Use `isRegistered` afterward if you need to confirm which ones took.

```ts
import { app, globalShortcut } from 'bunmaska';

app.whenReady().then(() => {
  globalShortcut.registerAll(['CmdOrCtrl+1', 'CmdOrCtrl+2', 'CmdOrCtrl+3'], () => {
    console.log('a numbered shortcut fired');
  });

  console.log(globalShortcut.isRegistered('CmdOrCtrl+1'));
});
```

### `globalShortcut.isRegistered(accelerator)`

* `accelerator` string - An accelerator shortcut.

Returns `boolean` - Whether this application currently holds `accelerator`.

This reflects Bunmaska's own registry: it is `true` only for accelerators this app successfully registered and has not unregistered. A combo owned by some other application reads as `false` here.

```ts
import { globalShortcut } from 'bunmaska';

if (!globalShortcut.isRegistered('CmdOrCtrl+Shift+K')) {
  globalShortcut.register('CmdOrCtrl+Shift+K', () => console.log('hi'));
}
```

### `globalShortcut.unregister(accelerator)`

* `accelerator` string - An accelerator shortcut.

Releases the OS grab for `accelerator`. A no-op if this app did not have it registered.

```ts
import { globalShortcut } from 'bunmaska';

globalShortcut.unregister('CmdOrCtrl+Shift+K');
```

### `globalShortcut.unregisterAll()`

Releases every accelerator this app registered. Call it on `will-quit` so you leave the system's shortcut table clean.

```ts
import { app, globalShortcut } from 'bunmaska';

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
```

## Events

This module emits no events. (Electron's `globalShortcut` has none either, so nothing is missing here.)

## Properties

This module exposes no properties - only the methods above on the `globalShortcut` singleton.

## Not in Bunmaska (yet)

- **`globalShortcut.setSuspended(suspended)`** - Electron can globally pause/resume all shortcut handling (handy while a user is rebinding keys). Not implemented; there is no suspend state in the Bunmaska source.
- **`globalShortcut.isSuspended()`** - the companion getter for the above. Also absent.
- **`registerAll` boolean result** - present, but its signature returns `void` rather than a batch boolean; check individual results with `isRegistered`.
- **Wayland global shortcuts** - Linux support is X11-only and best-effort. Under Wayland the backend reports unsupported and `register` returns `false`; the `org.freedesktop.portal.GlobalShortcuts` path is deferred.
- **Windows** - out of scope entirely. Bunmaska targets macOS and Linux only, so there is no Win32 backend.
- **macOS media-key accelerators** (`Media Play/Pause`, `Media Next Track`, etc.) - the accelerator parser recognizes a named-key set, but the documented Electron media keys and their accessibility-authorization caveat are not specially handled here; treat media-key support as unverified rather than guaranteed.

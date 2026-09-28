---
title: "Errors & platform helpers"
description: "What bunmaska exports for error handling and platform checks: the BunmaskaError family, currentPlatform / isSupported, BUNMASKA_VERSION, and the option types."
order: 25
---

Process: Main

Beyond the Electron-shaped modules, the `bunmaska` barrel exports a small set of helpers you will reach for when an API throws or when you branch per platform. None of these exist in Electron; they are Bunmaska's own.

## Errors

Errors from Bunmaska's own contracts are a `BunmaskaError`. Branch on `instanceof` and on the stable `code` field, never on message text.

A few throws are deliberately something else, mostly where Electron itself throws a plain type:

- `TypeError` - `Object has been destroyed` from a closed window or its `webContents` (as in Electron), a malformed `webContents.sendInputEvent` event, and preload IPC arguments that JSON cannot carry.
- `Error` - everything `autoUpdater` throws or rejects with, and the "not implemented" error the `bunmaska/electron` shim raises for a known Electron module Bunmaska lacks.

| Class | `code` | Thrown when |
| --- | --- | --- |
| `BunmaskaError` | `undefined` on the base class | Base class for everything below. |
| `UnsupportedPlatformError` | `ERR_UNSUPPORTED_PLATFORM` | An API is called on a platform that does not support it (e.g. `sendInputEvent` off Windows). |
| `InvalidArgumentError` | `ERR_INVALID_ARGUMENT` | An argument violates a documented contract - an unknown `app.getPath` name, a relative `app.setPath`, `protocol.handle` on a built-in scheme, a zoom factor that is not above `0`, a module-syntax preload a compiled app cannot bundle. |
| `FFIError` | `ERR_FFI` | A native library or symbol cannot be loaded or resolved through `bun:ffi`. |

```ts
import { app, InvalidArgumentError, UnsupportedPlatformError } from 'bunmaska';

try {
  app.getPath('nope');
} catch (err) {
  if (err instanceof InvalidArgumentError) console.error(err.code, err.message);
}
```

## Warnings

Some calls do not throw but tell you they did nothing useful - `openDevTools` on Windows, `setWindowOpenHandler` returning `allow`, a custom scheme Windows cannot serve. Those warnings (and errors Bunmaska catches for you, such as a throwing IPC listener) go to stderr, prefixed `[bunmaska:<module>]`. When a page says "logs a warning", that line is what it means.

## Platform checks

- `currentPlatform()` - returns `'macos' | 'linux' | 'windows'` (the `Platform` type is exported too).
- `isSupported(platform)` - `true` for the platforms Bunmaska runs on.
- `BUNMASKA_VERSION` - the framework version string, for logs and about panels.

```ts
import { currentPlatform, isSupported, BUNMASKA_VERSION } from 'bunmaska';

console.log(`bunmaska ${BUNMASKA_VERSION} on ${currentPlatform()}`, isSupported(currentPlatform()));
```

## Option types

The option shapes the main-process APIs take are exported for your own signatures: `WebPreferences` (the `BrowserWindow` `webPreferences` bag), `LoadFileOptions` (`webContents.loadFile`), `MenuPopupOptions` (`menu.popup`), and `MouseInputEvent` / `KeyboardInputEvent` (`webContents.sendInputEvent`).

```ts
import type { MenuPopupOptions, WebPreferences } from 'bunmaska';
```

---
title: Buildless Native Modules
description: The moat. A native module is a .ts file with a dlopen symbol table over the OS's stable C ABI - no node-gyp, no N-API, no electron-rebuild, no compile step.
order: 1
---

This is the part Electron can't match without un-bundling Chromium. In Bunmaska, talking to the operating system is not a build problem - it's just code.

## What a native module *is*

A native module is a TypeScript file that `dlopen`s a system library and calls it through `bun:ffi`. That's the entire mechanism. There is no `node-gyp`, no N-API, no `binding.gyp`, no Python, no compile step, and no ABI pinning - because you bind the *stable system C ABI* (`libc`, IOKit, GTK), which doesn't move when you upgrade your framework.

```ts
// A native module. No build step. No bindings.gyp. Just Bun.
import { dlopen, FFIType, ptr } from "bun:ffi";

const { symbols: libc } = dlopen("libc.so.6", {
  getpid: { args: [], returns: FFIType.i32 },
});

export const pid = () => libc.getpid();
```

It's not aspirational - it's how Bunmaska itself is built. About thirty system libraries (AppKit, IOKit, Carbon, CoreGraphics, GTK4, WebKitGTK, libsecret, …) are wired exactly this way, with zero compiled native code in the tree.

## The three rules you must internalize

The limits here are FFI-shaped, not build-shaped. An addon author should know them up front:

1. **No struct-by-value *return*.** `bun:ffi` can't return a C struct by value. Struct *arguments* are fine - pass them by reference as a `Uint8Array`.
2. **JSCallback lifetime.** Keep a callback (and its buffers) alive until it fires, and never `close()` it from inside its own invocation. Retained-forever callbacks via runtime classes / signal-connect are the sanctioned delegate mechanism.
3. **The pump rule.** Never block the single cooperatively-pumped main thread waiting on a reply only the run loop can deliver. Reads must be async/poll that cooperate with the pump.

## A real example: a serial port

A USB serial monitor is the cleanest demo of "buildless native module." The whole thing is POSIX:

- **macOS:** the adapter shows up as `/dev/cu.usbserial*`. `dlopen("libSystem.B.dylib")`, `open()` the device, configure with `termios` (`cfsetspeed`/`tcsetattr`), then `read()`. Enumeration/hotplug via IOKit.
- **Linux:** `/dev/ttyUSB*` / `/dev/ttyACM*`, identical `termios` calls via `dlopen("libc.so.6")`; `libudev` for hotplug.

No compiled code. No prebuilds. Just a `.ts` file that opens a file descriptor and talks to it.

> **The Web Serial caveat.** `navigator.serial` / WebHID / WebUSB are **Chromium-only** - system WebKit doesn't implement them. So device access in Bunmaska lives in the **main process** (via FFI) and crosses IPC to the renderer. In exchange, you skip the entire `node-gyp` / `electron-rebuild` dance. It's a cleaner deal than it sounds.

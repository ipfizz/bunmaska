---
title: Migrating from Electron
description: "Move an Electron app to bunmaska by changing your imports. What maps one-to-one, what differs, and the drop-in electron shim that errors honestly."
seoTitle: "Migrate from Electron to bunmaska"
order: 1
---

bunmaska is drop-in **for the core module set**. Most apps that live inside `app` / `BrowserWindow` / `ipcMain` / `Menu` / `dialog` / `clipboard` / `shell` / `Tray` map across with an import change. The long tail is a different story - and we'll be honest about which is which.

## Change your imports

```ts
// Before
import { app, BrowserWindow, ipcMain } from "electron";

// After
import { app, BrowserWindow, ipcMain } from "bunmaska";
```

Or use the explicit compatibility shim, which **throws an actionable error naming the exact missing module** instead of handing you a silent `undefined` to debug:

```ts
import { app, BrowserWindow } from "bunmaska/electron";
```

Reaching for a known-but-unimplemented module (say `electron.netLog`) fails loudly and tells you what's missing. You find the gaps in the first five minutes, not in production.

## What ports cleanly

Windows, web contents, IPC, context isolation, menus, dialogs, clipboard (incl. images), tray, protocol handlers, power monitoring, `safeStorage`, `nativeImage`, `nativeTheme`, `globalShortcut`, notifications, screen info - across macOS, Linux, and Windows. A handful of cells differ per platform (e.g. custom protocols and `printToPDF`/`capturePage` are engine-blocked on Windows); see the [parity matrix](/docs/migrating/parity) for method-level detail.

## What needs real work

- **`BrowserView` / `WebContentsView`** - bunmaska is single-process; these aren't available.
- **Synchronous IPC** (`ipcRenderer.sendSync`) - the context bridge is async-only. Move to `invoke`.
- **The Chromium-internal surface** - `desktopCapturer`, `net`/`netLog`, `webRequest`/proxy, `crashReporter`, `contentTracing`, extensions. Out of scope by design.

## The one migration detail that bites

**Web Serial, WebHID, and WebUSB are Chromium-only.** System WebKit does not expose `navigator.serial` / `.hid` / `.usb`. If your Electron app does device access from the **renderer**, that code is **not** drop-in - it must move to the main process and cross IPC.

The upside: device access in the main process via [bunmaska's buildless native modules](/docs/native-modules/overview) is arguably *cleaner* than `node-serialport` - no `node-gyp`, no `electron-rebuild`, no per-arch prebuilds. An Electron app that already does serial in the main process maps over almost unchanged.

> The honest framing: bunmaska is "drop-in if you live inside the core module set." If you lean on `session.cookies`, `BrowserView`, sync IPC, Web Serial, or an N-API addon, expect an *architecture change*, not a recompile.

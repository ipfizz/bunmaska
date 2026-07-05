---
title: Introduction
description: "bunmaska is a drop-in Electron replacement built on Bun and system WebKit. Same app, BrowserWindow and ipcMain APIs - no bundled Chromium. Alpha."
seoTitle: "Introduction - a drop-in Electron replacement on Bun"
order: 1
---

You already know how to use Bunmaska, because it looks exactly like Electron. You write against `app`, `BrowserWindow`, `ipcMain`, `ipcRenderer`, `Menu`, `dialog`, `clipboard` - the names you've been typing for years. The difference is everything underneath:

- **Runtime:** Bun, not Node.
- **Renderer:** the system WebKit (`WKWebView` on macOS, WebKitGTK on Linux) - **not** a second copy of Chromium bundled into every app.
- **Native code:** none. The whole framework is TypeScript calling the operating system through `bun:ffi`. Zero compiled native code, zero runtime dependencies.

The result is an app that downloads in **~16-23 MB** instead of 150 MB+, and a native-module story that doesn't involve `node-gyp` ever again.

## The three things that matter

1. **No bundled browser.** We don't ship Chromium - your apps render on WebKit instead, so there's no second browser engine baked into each one.
2. **Buildless native modules.** A native module is a `.ts` file that `dlopen`s the OS. No N-API, no `electron-rebuild`, no compile step. See [Native Modules](/docs/native-modules/overview).
3. **Drop-in API.** The module names and shapes match Electron's, with a `bunmaska/electron` shim so you can point your existing imports at it. We cover roughly **70-80%** of what real apps actually use, and we [publish the gaps](/docs/migrating/parity) so you can check before you commit.

## Status

It's **alpha**. It genuinely works on **macOS, Linux, and Windows** today - real windows, the OS's own WebKit rendering (system on macOS/Linux, a from-source WinCairo build bundled on Windows), Electron-style IPC with context isolation, menus, tray, dialogs, clipboard (incl. images), `nativeImage`, `safeStorage`, `powerMonitor`, and a CLI that packages real `.app`/`.deb`/`.exe` distributables (plus `.dmg` with a flag). A few APIs differ per platform - `printToPDF`/`capturePage` are macOS-only, and those two plus custom `protocol://` are engine-blocked on Windows - and the [parity matrix](/docs/migrating/parity) is honest about every cell. Some method-level corners are still being filled in.

If you're evaluating it for production, read the word "alpha" one more time, then keep reading anyway.

## Where to go next

- [Why Bunmaska](/docs/why-bunmaska) - the case, made honestly.
- [Installation](/docs/installation) - `npm i bunmaska`.
- [Quickstart](/docs/quickstart) - from zero to a window in about ninety seconds.

---
title: API Parity & Gaps
description: "The single source of truth for which Electron modules and methods bunmaska implements, per platform (macOS, Linux, Windows). Honest, cell by cell."
seoTitle: "Electron API parity matrix - per module, per platform"
order: 2
---

We're allergic to lying in tables, so here's the honest map. Bunmaska implements **~21 of Electron's main-process modules** - about **70-80% of what a typical webview app actually uses** - and now ships on **three platforms**: macOS (AppKit + WKWebView), Linux (GTK 4 + WebKitGTK 6), and Windows (WinCairo WebKit + Win32). No bundled Chromium on any of them.

Support is not uniform across platforms, and we won't pretend it is. The table below is the source of truth.

**Legend:** ✅ full · ◐ partial (see notes) · ⚙️ engine-blocked (the OS WebKit lacks the API) · ✕ not implemented.

## The matrix

| Module | macOS | Linux | Windows | Notes |
| --- | :---: | :---: | :---: | --- |
| `app` | ✅ | ✅ | ✅ | Lifecycle, paths, single-instance, locale. Dock/badge/about-panel are macOS-only and no-op elsewhere (as in Electron). |
| `BrowserWindow` | ✅ | ◐ | ◐ | `setPosition`/`setBounds` move + size the window on Windows; macOS placement is best-effort (bottom-left origin) and Linux leaves placement to the compositor (GTK4), so `setPosition` is size-only there. Windows `setMinimumSize` is a no-op (needs `WM_GETMINMAXINFO`). |
| `webContents` (core) | ✅ | ✅ | ✅ | load/navigation/`executeJavaScript`/zoom/`insertCSS`/IPC `send` everywhere. `setWindowOpenHandler({action:'allow'})` is unimplemented on all three (`window.open` is blocked by default). |
| `webContents.printToPDF` | ✅ | ✕ | ⚙️ | macOS via `createPDFWithConfiguration`. Linux: not yet wired. Windows: engine-blocked (no PDF sink in the WinCairo C API). |
| `webContents.capturePage` | ✅ | ✕ | ⚙️ | macOS via snapshot. Linux: planned (`webkit_web_view_get_snapshot`). Windows: engine-blocked (no UI-process snapshot). |
| `ipcMain` / `ipcRenderer` | ✅ | ✅ | ✅ | `handle`/`on`/`invoke`/`send`. |
| `contextBridge` | ✅ | ✅ | ◐ | Real isolated content world on macOS/Linux. Windows runs in the page world (WinCairo exposes no named world) - the bridge works, but the isolation guarantee is weaker. |
| `Menu` / `MenuItem` | ✅ | ✅ | ✅ | Context menus + application menu bar on all three. Linux/Windows render role items as labels (their native shortcuts still work); accelerator text in labels is a follow-up. |
| `dialog` | ✅ | ◐ | ◐ | Linux: `openDirectory`/`multiSelections` ignored, severity is a no-op. Windows: custom button labels approximated (native `MessageBoxW` button sets). |
| `clipboard` | ✅ | ✅ | ✅ | text / HTML / image on all three. Reads are async everywhere (GDK requires it). |
| `Tray` | ✅ | ◐ | ◐ | Linux: SNI tray, gated behind `BUNMASKA_ENABLE_LINUX_TRAY`, no context menu yet. Windows: icon + tooltip + left-click, context menu deferred. |
| `Notification` | ◐ | ✅ | ✅ | macOS delivers only from a real `.app` bundle (`isSupported()` is honest about it); click/close events not wired. Linux: `close` event only. Windows: balloon toast (rich toasts are a follow-up). |
| `nativeImage` | ✅ | ✅ | ✅ | path/buffer/dataURL/PNG/JPEG/resize/crop. JPEG quality is honored on macOS only. |
| `nativeTheme` | ✅ | ◐ | ◐ | macOS: read + `themeSource` override + live `updated`. Linux: read + live `updated`, but `themeSource` is TS-only (no native re-theme). Windows: read-only (live observation is a follow-up). |
| `globalShortcut` | ✅ | ◐ | ✅ | Linux: X11 only (`isSupported()` is `false` under Wayland). |
| `shell` | ✅ | ✅ | ✅ | `openExternal`/`openPath`/`showItemInFolder`/`beep`. Linux `showItemInFolder` opens the parent folder without selecting. |
| `protocol` | ✅ | ✅ | ⚙️ | Custom scheme handlers serve on macOS/Linux. Windows: engine-blocked - the WinCairo C API exposes no scheme-handler entry point. |
| `screen` | ◐ | ◐ | ◐ | Display enumeration + scale factor work everywhere. `getCursorScreenPoint` and some secondary-display fields (work-area, rotation) are stubbed/approximated - a `bun:ffi` struct-return limitation. |
| `powerMonitor` | ◐ | ◐ | ✅ | suspend/resume + lock/unlock on all three. `getSystemIdleTime`/`isOnBatteryPower` not implemented on any. Linux is gated behind `BUNMASKA_ENABLE_LINUX_POWER`. |
| `powerSaveBlocker` | ✅ | ◐ | ✅ | Linux: gated, and both blocker types map to screensaver inhibition. |
| `safeStorage` | ✅ | ◐ | ✅ | macOS Keychain, Windows DPAPI. Linux: libsecret, gated behind `BUNMASKA_ENABLE_LINUX_KEYRING` (no plaintext fallback - encrypt/decrypt throw when unavailable). |
| `session` | ◐ | ◐ | ◐ | `getUserAgent`/`setUserAgent` everywhere. `clearStorageData`: macOS clears all website data; Windows clears cookies + fetch caches; Linux not yet wired. No `session.cookies` object yet. |
| `autoUpdater` | ◐ | ◐ | ◐ | The check/download/verify/stage pipeline is real and cross-platform. The final **install** step is an experimental stub on every OS - apps supply their own for now. |
| `accelerator` · `app-paths` · `requestSingleInstanceLock` | ✅ | ✅ | ✅ | Pure or fully-wired on all three. |

## Engine-blocked (⚙️) - why these can't ship on a given OS

These aren't laziness; the OS's WebKit simply doesn't expose the API:

- **Windows `protocol` / `printToPDF` / `capturePage`** - the WinCairo WebKit2 C API has no custom-scheme-handler, no PDF sink (`WKPageDrawPagesToPDF` is Cocoa-only), and no UI-process snapshot (only the web-process `WKBundlePage*` variants). We confirmed each by parsing `WebKit2.dll`'s export table. They become available only if upstream WinCairo adds them.

## Pending (inside shipped modules)

Real gaps we're actively filling: `session.cookies` (get/set/remove) and `session.clearStorageData` on Linux; Linux `capturePage` via `webkit_web_view_get_snapshot`; richer `webContents` events; live `nativeTheme` observation on Windows; tray context menus on Linux/Windows; `BrowserWindow.setMinimumSize` on Windows; the isolated content world on Windows.

## Out of scope by design

Chromium-internal surfaces - not coming, and that's deliberate:

`BrowserView` / `WebContentsView` (single-process) · `desktopCapturer` · `net` / `netLog` · `webRequest` / proxy · `crashReporter` · `contentTracing` · `utilityProcess` · `TouchBar` · `inAppPurchase` · extensions · `pushNotifications` · Web Serial / WebHID / WebUSB.

> If a cell you need is ◐, ⚙️, or in "pending," now you know - before you've ported half your app. That's the whole reason this page exists.

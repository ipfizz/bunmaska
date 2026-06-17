---
title: API Parity & Gaps
description: Roughly 70-80% of Electron's surface, weighted to what real apps use - and we publish the gap so you can check before you commit.
order: 2
---

We're allergic to lying in tables, so here's the honest map. Bunmaska implements **21 of Electron's main-process modules** (~58% of the raw count), which works out to about **70-80% of what a typical webview app actually uses**.

## Implemented

These ship and behave like Electron's, on **both macOS and Linux**:

| Module | Notes |
| --- | --- |
| `app` | lifecycle, paths, single-instance, `userAgentFallback` |
| `BrowserWindow` | create/load, resizable, opacity, min-size, center, devtools |
| `webContents` | zoom, getTitle, stop/reload, `capturePage` + `printToPDF` (macOS) |
| `ipcMain` | `handle` / `on` |
| `Menu` / `MenuItem` | roles, checkbox/radio, popup, macro roles |
| `dialog` | filters, message box severity, error box |
| `clipboard` | text, HTML, **image** |
| `Tray` | icon + context menu |
| `Notification` | native notifications |
| `nativeImage` | path/buffer/dataURL/PNG/JPEG/resize/crop |
| `nativeTheme` | dark/light + observer + reduced-transparency |
| `globalShortcut` | accelerator registration |
| `shell` · `protocol` · `screen` · `powerMonitor` · `powerSaveBlocker` · `safeStorage` · `session` (UA + clearStorageData) · `autoUpdater` | |

Renderer side: `ipcRenderer` + `contextBridge` (real context isolation via a dedicated isolated world).

## Pending (inside shipped modules)

Real gaps we're actively filling:

| Area | Status |
| --- | --- |
| `session.cookies` | get/set/remove - **planned** (the cocoa-block primitive that unblocks it already landed) |
| `BrowserWindow.setBounds` / `setPosition` | needs the by-reference struct-arg workaround |
| richer `webContents` events | `dom-ready`, `did-navigate`, `console-message` |
| Linux `capturePage` | via `webkit_web_view_get_snapshot` |

## Out of scope by design

Chromium-internal or Windows-only surfaces. Not coming, and that's deliberate:

`BrowserView` / `WebContentsView` (single-process) · `desktopCapturer` · `net` / `netLog` · `webRequest` / proxy · `crashReporter` · `contentTracing` · `utilityProcess` · `TouchBar` · `inAppPurchase` · extensions · `pushNotifications` · Web Serial / WebHID / WebUSB · all Windows-only members.

> If a row you need is in "pending" or "out of scope," now you know - before you've ported half your app. That's the whole reason this page exists.

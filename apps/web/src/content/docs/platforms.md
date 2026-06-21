---
title: Platform Support
description: Exactly which operating systems and CPU architectures Bunmaska runs on today, and the plan for the ones it doesn't.
order: 4
---

Bunmaska ships on **macOS and Linux** today. A **Windows** backend (WinCairo WebKit) is in active development - it's real in the code and runs on CI, but not yet shippable end-to-end (it needs a hosted WinCairo engine). The honest matrix, on the first page rather than three weeks into a port:

## The support matrix

| Platform | Status | Architectures | Engine |
| --- | --- | --- | --- |
| **macOS** | ✅ Shipping | Apple Silicon (ARM64) + Intel (x64) | AppKit + `WKWebView` |
| **Linux** | ✅ Shipping | x64 + ARM64 (incl. Raspberry Pi) | GTK 4 + WebKitGTK 6 |
| **Windows** | 🚧 In development | x64 + ARM64 | WinCairo WebKit (from the store) |

## macOS

- **Versions:** modern macOS (the WebKit + AppKit symbols Bunmaska binds are stable across recent releases).
- **Architectures:** both Apple Silicon (`arm64`) and Intel (`x64`). Bun runs natively on both; the system WebKit is whatever your Mac ships.
- This is the **most complete** backend - windows, IPC, menus, tray, dialogs, `capturePage`/`printToPDF`, and packaging all work.

## Linux

- **Requirements:** GTK 4 and **WebKitGTK 6.0** must be present (`libgtk-4.so.1`, `libwebkitgtk-6.0.so.4`). These ship on most modern desktops; on minimal/server images install your distro's `webkitgtk-6.0` package.
- **Architectures:** `x64` and `ARM64`. ARM64 includes **Raspberry Pi** (Pi 4/5 on a 64-bit OS) wherever WebKitGTK 6 is available - same pure-FFI code path, no special build.
- **Display:** a desktop session (X11 or Wayland). Headless/CI runs need a virtual display (e.g. `Xvfb`) and the WebKitGTK sandbox flags.

## Windows

**In active development.** A from-scratch Win32 backend is built on pure `bun:ffi` - native windows + a cooperative message pump, the **WinCairo WebKit** view (WebKit's real Windows port, *not* WebView2/Chromium), the renderer↔main IPC bridge, and ~10 modules (clipboard, tray, `safeStorage` via DPAPI, screen, shell, global shortcuts, power, native theme). It validates on a `windows-latest` CI runner.

- **Architectures:** `x64` and `ARM64`. 32-bit (x86) is not supported, on purpose.
- **Engine:** Windows ships no system WebKit, so an app loads **WinCairo `WebKit2.dll` from the engine store** - the same pinned-engine mechanism as the other platforms, with the engine directory put on the DLL search path so its dependency closure resolves beside it.
- **The catch:** we don't host prebuilt WinCairo engines yet, so a Windows app needs one provided locally (`BUNMASKA_WEBKIT_PATH` or a local store install). Hosting those builds is the last step before Windows ships end-to-end - the same step Linux's pinned tier is waiting on.
- **Known gaps:** `printToPDF` / `capturePage`, DevTools, clipboard images, and the tray context menu aren't wired yet - they throw a clear error rather than silently no-op. Full picture on the [roadmap](/roadmap).

## Requirements (all platforms)

- **[Bun](https://bun.sh) ≥ 1.3** - Bunmaska runs on Bun, not Node.
- The system WebKit listed above. **No Chromium is downloaded or bundled, ever.**

Next: [Building & Distribution](/docs/building) - how to package for each of these.

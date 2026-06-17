---
title: Platform Support
description: Exactly which operating systems and CPU architectures Bunmaska runs on today, and the plan for the ones it doesn't.
order: 4
---

Bunmaska is a **macOS + Linux** framework. It is not cross-platform until Windows works, and we'd rather tell you that on the first page than have you find out three weeks into a port.

## The support matrix

| Platform | Status | Architectures | Engine |
| --- | --- | --- | --- |
| **macOS** | ✅ Shipping | Apple Silicon (ARM64) + Intel (x64) | AppKit + `WKWebView` |
| **Linux** | ✅ Shipping | x64 + ARM64 (incl. Raspberry Pi) | GTK 4 + WebKitGTK 6 |
| **Windows** | ⏳ Planned | - | WinCairo WebKit (see [roadmap](/roadmap)) |

## macOS

- **Versions:** modern macOS (the WebKit + AppKit symbols Bunmaska binds are stable across recent releases).
- **Architectures:** both Apple Silicon (`arm64`) and Intel (`x64`). Bun runs natively on both; the system WebKit is whatever your Mac ships.
- This is the **most complete** backend - windows, IPC, menus, tray, dialogs, `capturePage`/`printToPDF`, and packaging all work.

## Linux

- **Requirements:** GTK 4 and **WebKitGTK 6.0** must be present (`libgtk-4.so.1`, `libwebkitgtk-6.0.so.4`). These ship on most modern desktops; on minimal/server images install your distro's `webkitgtk-6.0` package.
- **Architectures:** `x64` and `ARM64`. ARM64 includes **Raspberry Pi** (Pi 4/5 on a 64-bit OS) wherever WebKitGTK 6 is available - same pure-FFI code path, no special build.
- **Display:** a desktop session (X11 or Wayland). Headless/CI runs need a virtual display (e.g. `Xvfb`) and the WebKitGTK sandbox flags.

## Windows

Not supported yet - and deliberately so. The easy route (WebView2) is Chromium, which is exactly what Bunmaska exists to avoid. The real route is **WinCairo**, WebKit's Windows port; when it's reliably embeddable, Bunmaska's architecture ports to it cleanly. Full reasoning on the [roadmap](/roadmap).

If your project needs Windows today, Bunmaska isn't the tool for that target yet.

## Requirements (all platforms)

- **[Bun](https://bun.sh) ≥ 1.3** - Bunmaska runs on Bun, not Node.
- The system WebKit listed above. **No Chromium is downloaded or bundled, ever.**

Next: [Building & Distribution](/docs/building) - how to package for each of these.

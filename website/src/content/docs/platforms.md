---
title: Platform Support
description: "Which WebKit bunmaska uses on each OS: WKWebView on macOS, WebKitGTK on Linux, from-source WinCairo on Windows, in beta (x64). Never Chromium."
seoTitle: "Platform support - macOS, Linux, Windows (x64)"
order: 4
---

Bunmaska ships on **macOS, Linux, and now Windows** (in beta, x64) - each driving the operating system's own WebKit in pure `bun:ffi`. macOS and Linux use the WebKit that's already on the machine; Windows has none, so it loads a **WinCairo WebKit we build from source and bundle**. Support isn't identical across the three, and we publish exactly where it differs (see the [parity matrix](/docs/migrating/parity)). The honest summary:

## The support matrix

| Platform | Status | Architectures | Engine |
| --- | --- | --- | --- |
| **macOS** | <span class="st st-full" role="img" aria-label="full"></span> Shipping | Apple Silicon (ARM64) + Intel (x64) | AppKit + `WKWebView` |
| **Linux** | <span class="st st-full" role="img" aria-label="full"></span> Shipping | x64 + ARM64 (incl. Raspberry Pi) | GTK 4 + WebKitGTK 6 |
| **Windows** | <span class="st st-partial" role="img" aria-label="partial"></span> Beta (x64) | x64 today · ARM64 on the roadmap | WinCairo WebKit (built from source, bundled) |

## macOS

- **Versions:** macOS 13 (Ventura) or later - the oldest macOS a Bun-compiled binary loads on, and what a built `.app` declares.
- **Architectures:** both Apple Silicon (`arm64`) and Intel (`x64`). Bun runs natively on both; the system WebKit is whatever your Mac ships.
- This is the **most complete** backend - windows, IPC, menus, tray, dialogs, `capturePage`/`printToPDF`, and packaging all work.

## Linux

- **Requirements:** **GTK 4.10+** and **WebKitGTK 6.0 at 2.42+** must be present (`libgtk-4.so.1`, `libwebkitgtk-6.0.so.4`). These ship on most modern desktops; on minimal/server images install your distro's `webkitgtk-6.0` package. The floors are hard: Bun resolves each native symbol table in one go, so an older GTK breaks every dialog and an older WebKitGTK breaks every window, rather than one missing feature.
- **Architectures:** `x64` and `ARM64`. ARM64 includes **Raspberry Pi** (Pi 4/5 on a 64-bit OS) wherever WebKitGTK 6 is available - same pure-FFI code path, no special build.
- **Display:** a desktop session (X11 or Wayland). Headless/CI runs need a virtual display (e.g. `Xvfb`) and the WebKitGTK sandbox flags.

## Windows

A from-scratch Win32 backend on pure `bun:ffi` - native windows + a cooperative message pump, the **WinCairo WebKit** view (WebKit's real Windows port, *not* WebView2/Chromium), the renderer↔main IPC bridge (no context isolation yet: the preload and `window.__bunmaska` run in the page world, so load only trusted content), an application menu bar, and the secondary modules: clipboard (text/HTML/**images**), dialogs, menus, tray, notifications, `safeStorage` via DPAPI, screen, shell, global shortcuts, power monitor/blocker, native theme, and `session.clearStorageData`. It validates on a `windows-latest` CI runner alongside macOS and Linux.

- **Architectures:** `x64` today. Upstream WinCairo is x64-only, so **ARM64 is on the roadmap**, not shipping. 32-bit (x86) is not supported, on purpose.
- **Engine:** Windows ships no system WebKit, so an app loads a **WinCairo `WebKit2.dll`** - built from WebKit source by us (a clang-cl from-source build, proven end-to-end) and bundled with the app, or resolved from the engine store. The engine directory is placed on the DLL search path so its dependency closure (ICU, libcurl, ANGLE, …) resolves beside it.
- **The distribution piece:** you can ship a Windows app **today** by embedding the engine in the build: `engine.embed: true` for a pinned engine you installed from the feed, or `bunmaska build --embed-engine <dir>` for your own build. On a dev machine, `BUNMASKA_WEBKIT_PATH` or a pinned engine in the store also works. With no engine at all, the app refuses to start and tells you which of those to provide. A hosted WinCairo engine is on the feed today; the stable-train build and ARM64 are next.
- **Engine-blocked gaps:** `printToPDF`, `capturePage`, and custom `protocol://` schemes can't be served on Windows - the WinCairo WebKit2 C API simply doesn't expose those entry points (confirmed against the DLL's exports). `printToPDF` and `capturePage` reject with a clear error, and creating a window while custom schemes are registered logs a warning, rather than anything silently no-opping. DevTools, the tray context menu, and a fully isolated content world are follow-ups. Full picture on the [parity matrix](/docs/migrating/parity).

## Requirements (all platforms)

- **[Bun](https://bun.sh) ≥ 1.3** - Bunmaska runs on Bun, not Node.
- The system WebKit listed above. **No Chromium is downloaded or bundled, ever.**

Next: [Building & Distribution](/docs/building) - how to package for each of these.

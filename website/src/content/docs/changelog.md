---
title: Changelog
description: Every published release gets an entry here - what shipped, what broke, and what we deferred, honestly.
order: 2
---

The current version is **`0.1.0-alpha.5`**, live on npm - `npm i bunmaska`. Newest first; still a curated snapshot rather than a per-commit log.

## Unreleased

**Event-driven macOS run loop.** The cooperative pump no longer polls AppKit at a fixed 60 Hz. It sleeps in `CFRunLoopRunInMode` until a native event arrives - input wakes it instantly - and backs off adaptively when idle. On an idle window that is roughly **10x less CPU** (~2.5% → ~0.2%) with no added input latency. One honest trade-off: while the UI is idle, *main-process* JS timers run at up to ~125 ms granularity (renderer `requestAnimationFrame` and IPC are unaffected - they ride the native event path).

A true libuv-style integration like Electron's is not possible from pure `bun:ffi` today: Bun's loop is uSockets, not libuv, and its tick/wakeup primitives are not exported ([oven-sh/bun#18546](https://github.com/oven-sh/bun/issues/18546)). This is the best event-driven behavior achievable while staying single-threaded.

## `0.1.0-alpha.5`

Frameless windows, a real preload, and a dev loop that doesn't blink.

**Highlights**

- **Custom frameless title bars.** `frame: false` windows get an app-region drag handle and built-in window controls, shared across platforms - native drag on macOS, real controls on Windows. See [Frameless Windows](/docs/concepts/frameless-windows).
- **Preloads can import.** The preload is now bundled before injection, so `import`s in your preload work instead of silently breaking `window.api`.
- **`BrowserWindow.setPosition` / `setBounds`** - full on Windows, best-effort on macOS and Linux.
- **Live reload in dev.** `bunmaska dev` reloads the renderer when assets change instead of restarting the whole app.

**Fixes**

- `bunmaska build` skips dotfiles and never copies the build output into itself when collecting runtime assets.
- Windows web view is sized to the client area, so content is no longer clipped by the window frame.
- The frameless title-bar script no longer leaks `__bunmaska` into the page world on macOS and Linux.

## `0.1.0-alpha.4`

macOS packaged apps now actually work. Building a real app surfaced four bugs that each broke a double-clickable `.app`; all four are fixed, so `bunmaska build` produces a window that opens and responds to clicks and keys.

**Fixes**

- **Windows now appear.** A bundled app is brought to the foreground when its first window is shown, not only once at startup before any window exists.
- **Apps respond to input.** The macOS run loop now dispatches AppKit mouse and keyboard events (`nextEventMatchingMask:` / `sendEvent:`) each tick - the window used to render but ignore clicks.
- **Built apps no longer crash on launch.** `bunmaska build` copies your runtime assets (the page, the preload, CSS, images) beside the executable, and the scaffold resolves them by the executable's path when compiled - a compiled binary can't read files from `import.meta.dir`.
- **Signed apps no longer trap.** Code-signing grants the JIT entitlements Bun needs (`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`); without them a hardened-runtime app died on its first FFI call.

**Known limit**

- The macOS run loop is a cooperative ~60 Hz poll - complete and correct, but not yet event-driven (so up to ~16 ms input latency). An event-driven `CFRunLoop` integration is the next focused change.

## `0.1.0-alpha.3`

The first npm release - and Bunmaska became cross-platform on three OSes with a full **Windows** backend landed on `main`.

**Highlights**

- **Published to npm** - `npm i bunmaska`.

- **Win32 + WinCairo WebKit runtime** in pure `bun:ffi` - native windows + a cooperative message pump, the WinCairo WebKit view, renderer↔main IPC with context isolation, an **application menu bar**, and the secondary modules: clipboard (text/HTML/**images**), dialogs, menus, tray, notifications, `safeStorage` (DPAPI), screen, shell, global shortcuts, power monitor/blocker, native theme, and `session.clearStorageData`. Green on a `windows-latest` CI runner next to macOS and Linux.
- **From-source WinCairo engine** - we compile WebKit's WinCairo port from source (a clang-cl build), relocate it into the engine store, and proved a real `BrowserWindow` loads + runs JS from the store with no system WebKit (`STORE_ENGINE_OK`). A reproducible build script + CI workflow ship with it.
- **Honest per-platform parity matrix** published - every API cell marked full / partial / engine-blocked across macOS, Linux, and Windows.

**Caveats (documented, not hidden)**

- **Engine-blocked on WinCairo:** custom `protocol://` schemes, `printToPDF`, and `capturePage` - the WinCairo WebKit2 C API exposes no entry point for them.
- **x64 only** (upstream WinCairo is x64-only; ARM64 is on the roadmap). A **hosted prebuilt engine** is still pending - for now you build + embed the engine (proven) rather than fetch it.

## `0.1.0-alpha.2`

The pinned-WebKit engine store - the opt-in path to "tested == shipped." Most apps still use the system WebKit by default; this adds the machinery to ship the exact build you tested. See [Pinned WebKit Engine](/docs/concepts/engine).

**Highlights**

- **Side-by-side engine store** at `~/.bunmaska/webkit/` - content-addressed, many versions coexist, each app resolves its own pin (no global switch). Install marker, content-hash integrity, refcount, and garbage collection.
- **Launch resolver** - env → baked `engine.id` → marker check → loud fallback to the system WebKit if a pin is missing (the app still launches).
- **`bunmaska engine` CLI** (`list` / `which` / `install` / `use` / `prune` / `verify`) and **`bunmaska doctor`**.
- **Signed feed install** - `engine install <url>` verifies an Ed25519 signature + content hash before extracting.
- **Apps register on launch** so `prune` only collects engines nothing needs.
- On Linux, a pinned app loads its WebKit from the store rather than the system soname.
- Fixed: the generated `.deb` now declares its WebKitGTK + GTK `Depends`.

**Still in progress**

- A **self-contained, relocatable WebKit** that builds and loads from the store - its full dependency closure travels with it (`$ORIGIN`). Next: serving the prebuilt engines from a signed feed + the final render pass.
- macOS pinned engine (designed, feasible); engine delivery to end users (embed / auto-fetch). _(Windows via WinCairo has since landed - see Unreleased above.)_

## `0.1.0-alpha.0`

The first public alpha. It genuinely works on **macOS and Linux** (x64 and ARM), with no bundled Chromium and zero compiled native code.

**Platforms**

- macOS - AppKit + `WKWebView` via `objc_msgSend`.
- Linux - GTK 4 + WebKitGTK 6 via `dlopen`.
- x64 and ARM64 (incl. Raspberry Pi where WebKitGTK 6 is available).

**Modules (21)**

`app` · `BrowserWindow` · `webContents` · `ipcMain` / `ipcRenderer` · `contextBridge` ·
`Menu` / `MenuItem` · `dialog` · `clipboard` (incl. images) · `Tray` · `Notification` ·
`nativeImage` · `nativeTheme` · `globalShortcut` · `shell` · `protocol` · `screen` ·
`powerMonitor` · `powerSaveBlocker` · `safeStorage` · `session` · `autoUpdater`.

See the full [API Reference](/docs/api/app) for what each one actually implements, and the [parity matrix](/docs/migrating/parity) for the honest gaps.

**Highlights**

- Real context isolation in a dedicated isolated world on both platforms.
- The CLI: `bunmaska init` / `dev` / `run` / `build`.
- Packaging to real distributables - `.app`/`.dmg` (macOS), AppDir/`.deb` (Linux) - plus a pure-Bun `autoUpdater` (check → download → verify → stage).
- `webContents.capturePage` + `printToPDF` and `session.clearStorageData` (macOS).

**Known limits**

- **Alpha** - the API surface will move between releases. Pin your version.
- **Windows is beta** (x64, from-source WinCairo - see the [roadmap](/roadmap)); ARM64 waits on upstream.
- ~70-80% Electron parity; `session.cookies` and some `webContents` events are still in progress.
- `autoUpdater.quitAndInstall`'s final atomic swap-and-relaunch is experimental.

> The [roadmap](/roadmap) is the forward-looking companion to this page: every stop between here and beta, with exit criteria.

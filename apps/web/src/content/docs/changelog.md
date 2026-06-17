---
title: Changelog
description: Bunmaska is pre-release, so this is one honest snapshot rather than a running history. Once it's published to npm, every release gets an entry here.
order: 2
---

The current version is **`0.1.0-alpha.2`**. It is **not yet published to npm** - this page is a hardcoded snapshot of the alpha. Once the framework ships publicly, every release will get a proper dated entry here (semver, highlights, breaking changes, fixes).

## `0.1.0-alpha.2` - current

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
- macOS pinned engine (designed, feasible); Windows via WinCairo (deferred); engine delivery to end users (embed / auto-fetch).

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
- **No Windows** yet (planned via WinCairo - see the [roadmap](/roadmap)).
- ~70-80% Electron parity; `session.cookies`, `BrowserWindow.setBounds`, and some `webContents` events are still in progress.
- `autoUpdater.quitAndInstall`'s final atomic swap-and-relaunch is experimental.

> What changes here next: once `bunmaska` is live on npm, this page becomes a real changelog - dated entries, version by version. Until then, the [roadmap](/roadmap) is the forward-looking companion to this snapshot.

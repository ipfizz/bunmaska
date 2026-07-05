<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.png">
    <img src="assets/logo.png" width="240" alt="bunmaska - Electron, minus the Chromium">
  </picture>
</p>

<h1 align="center">bunmaska</h1>

<p align="center">
  <em>Electron, minus the Chromium.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/bunmaska"><img src="https://img.shields.io/npm/v/bunmaska?style=flat-square&color=e0a019&label=npm" alt="npm"></a>
  <a href="https://github.com/ipfizz/bunmaska/stargazers"><img src="https://img.shields.io/github/stars/ipfizz/bunmaska?style=flat-square&color=e0a019&label=stars" alt="Stars"></a>
  <img src="https://img.shields.io/badge/platforms-macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-555?style=flat-square" alt="Platforms">
  <img src="https://img.shields.io/badge/Chromium-none-2f7d4f?style=flat-square" alt="No Chromium">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-555?style=flat-square" alt="MIT license"></a>
</p>

<p align="center">
  <strong>A drop-in Electron replacement on Bun and your OS's own WebKit.</strong><br>
  <sub>No bundled Chromium. Native modules that are just <code>.ts</code> files. It's alpha, and it says so.</sub>
</p>

<p align="center">
  <a href="https://bunmaska.org">Website</a> &middot;
  <a href="https://bunmaska.org/docs/introduction">Docs</a> &middot;
  <a href="https://bunmaska.org/docs/migrating/parity">API parity</a> &middot;
  <a href="https://bunmaska.org/roadmap">Roadmap</a>
</p>

---

**bunmaska** is a **drop-in Electron replacement** built on [Bun](https://bun.sh) and your operating system's own WebKit - an **Electron alternative without bundled Chromium**. You keep writing against the APIs you already know - `app`, `BrowserWindow`, `ipcMain`, `ipcRenderer`, `Menu`, `dialog`, `clipboard`, `webContents` - and we swap the heavy parts underneath: the runtime becomes Bun instead of Node, and the renderer becomes whatever WebKit your OS already ships. All of it is pure `bun:ffi` with **zero compiled native code** in the framework.

## Before / after

Change your imports. Keep your app.

```ts
// Before - Electron
import { app, BrowserWindow } from 'electron';

// After - bunmaska
import { app, BrowserWindow } from 'bunmaska';

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1024, height: 768 });
  win.loadURL('https://example.com');
});
```

That's the whole migration for most apps. The difference is what you *don't* ship: no second copy of Chromium baked into every build, so your app is a fraction of the size, your users stop getting browser CVEs that have nothing to do with your code, and your update is your code - not a browser. The smaller, faster apps are a side effect, not the pitch. [We measured it, though](https://bunmaska.org/docs/why-bunmaska) - we're allergic to lying in README files.

## How it works

Most "lighter Electron" projects are just better at gzipping. Anyone can gzip a binary. bunmaska does something structurally different:

1. **The runtime is Bun**, not Node - millisecond startup, TypeScript runs natively, no transpile step.
2. **The renderer is the system's WebKit** - `WKWebView` on macOS, WebKitGTK on Linux - not a second browser bundled into every app.
3. **The bridge is pure `bun:ffi`** - zero compiled native code, zero runtime dependencies, no postinstall build. Dozens of system libraries wired without a single `cc` call.
4. **The API is Electron-shaped** - same module names and shapes, so migrating is mostly changing an import.
5. **The engine is a choice, not a tax** - system WebKit by default, or [pin an exact build](https://bunmaska.org/docs/concepts/engine) when you need byte-for-byte consistency. Never Chromium.

## Install

Requires [Bun](https://bun.sh) - that's the entire point.

```sh
npm i bunmaska     # or: bun add bunmaska
```

Then scaffold, run, and package with the CLI:

```sh
bunmaska init my-app     # a runnable starter: main + preload + renderer + config
bunmaska dev             # run with file-watch + live reload
bunmaska build           # a standalone .app / .deb / .exe your users double-click
```

The CLI is *your* dev tool - it never ships inside your app. macOS and Linux run on the system WebKit with nothing to install; Windows (x64) is in beta on a from-source WinCairo build (never WebView2 - that's Chromium). The honest, per-platform status lives on the [platform support page](https://bunmaska.org/docs/platforms).

## CLI

| Command | What it does |
|---|---|
| `bunmaska init [dir]` | Scaffold a runnable starter project. |
| `bunmaska dev` | Run the app with file-watch restarts + renderer live-reload. |
| `bunmaska build` | Package a distributable for the current OS (`--target` cross-builds). |
| `bunmaska engine <cmd>` | Manage the pinned-WebKit engine store (`list` / `which` / `install`). |
| `bunmaska doctor` | Report the runtime, store, and the WebKit your project resolves to. |

Full reference, every flag → **[bunmaska.org/docs/cli](https://bunmaska.org/docs/cli)**.

## What you get

An Electron-shaped API surface - `app`, `BrowserWindow`, `webContents`, `ipcMain`/`ipcRenderer` with context isolation, `Menu`, `dialog`, `clipboard`, `Tray`, `Notification`, `nativeImage`, `safeStorage`, and more - plus an auto-updater and the engine store, all pure `bun:ffi`.

The README won't try to be the API reference, because that list only grows. The **full module list, per-platform status, and the exact Electron parity matrix** live where they can stay honest:

**→ [bunmaska.org/docs](https://bunmaska.org/docs/introduction) · [API parity matrix](https://bunmaska.org/docs/migrating/parity)**

## The part worth paying attention to

Two things that aren't "Electron but smaller" - they're structurally different.

**A native module is a `.ts` file.** Need a serial port, a USB device, the system keychain, IOKit? In Electron that's `node-gyp`, N-API, `electron-rebuild`, and a per-arch prebuild matrix that detonates every time you bump Electron. In bunmaska you write a small TypeScript file that `dlopen`s the OS and calls it directly. No compiler. No build step. No ABI compatibility matrix. No Python summoning ritual when you upgrade. Nothing to rebuild, because there was never anything to build. → [Native modules](https://bunmaska.org/docs/native-modules/overview)

**Pin the exact WebKit you tested.** By default your app renders on the system's WebKit - that's what keeps it tiny. When byte-for-byte rendering consistency matters, pin a specific, signature-verified build from a shared engine store - installed once, used by every app that pins it. Tested equals shipped, without Electron's per-app browser. → [The engine store](https://bunmaska.org/docs/concepts/engine)

## FAQ

**Is this production-ready?** No. It says alpha for a reason. If you're already running this in production, we admire your courage and decline all responsibility. If you're a large company doing an evaluation, please read the word "alpha" three more times before proceeding.

**Why not just Electron?** No bundled Chromium - so your apps are small, and the OS patches the browser engine for you while you sleep. Plus native modules with no build step. If you need the last slice of the API or battle-tested stability *today*, use Electron and check back.

**Does it really have no Chromium?** Correct. macOS and Linux render on the system's own WebKit; Windows ships a from-source WinCairo WebKit - the real WebKit port, never WebView2/Chromium.

**What breaks?** It's alpha, so: some of the Electron surface isn't implemented yet (it throws a clear error naming the missing module, not a mystery failure at 2 a.m.), and a few APIs differ per platform. We publish exactly which on the [parity matrix](https://bunmaska.org/docs/migrating/parity) - no fantasy, no vapor.

**Is it single-process?** Yes - one cooperatively-pumped Bun process, no per-window crash isolation. That's the architectural price of the lightness, and we're upfront about it on the [trade-offs page](https://bunmaska.org/docs/compare/bunmaska-vs-electron).

## Contributing

You somehow found this repo before we told anyone. Hello. Open an issue, keep your expectations realistic, and try not to be a jerk. A proper contributing guide will exist once the project is less "held together with optimism."

```sh
git clone https://github.com/ipfizz/bunmaska.git
cd bunmaska && bun install
bun run validate        # format + lint + type-check + test
```

The docs site lives in [`website/`](./website); the framework is this repo's root and publishes to npm as `bunmaska`.

## Status

**Alpha** - `0.1.0-alpha.5`. It genuinely works on macOS, Linux, and Windows (x64), it's on npm, and everything deeper lives at **[bunmaska.org](https://bunmaska.org)**. If it's still 2027 and this file still opens with "alpha," feel free to open an issue titled *"are you OK."*

## License

[MIT](./LICENSE). Go wild.

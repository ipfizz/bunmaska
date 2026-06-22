# Bunmaska

> The bread and butter of desktop apps: Electron's familiar APIs on Bun and your operating system's own WebKit. No bundled Chromium — because shipping 150 MB of browser with every app is one of those ideas that made sense in 2013 and has been quietly ruining laptop fans ever since.

<p>
  <a href="https://www.npmjs.com/package/bunmaska"><img src="https://img.shields.io/npm/v/bunmaska" alt="npm"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/platforms-macOS%20%C2%B7%20Linux%20%C2%B7%20Windows%20(alpha)-555" alt="platforms">
  <img src="https://img.shields.io/badge/Bun-%E2%89%A5%201.3-f9f1e1" alt="Bun >= 1.3">
</p>

### [Read the docs → bunmaska.org](https://bunmaska.org)

Bunmaska is a **drop-in replacement for Electron** that refuses to bundle an entire browser engine just so you can put a web page in a native window. You keep writing against the APIs you already know — `app`, `BrowserWindow`, `ipcMain`, `ipcRenderer`, `Menu`, `dialog`, `clipboard`, `webContents` — and we swap the heavy parts underneath: the runtime becomes [Bun](https://bun.sh) instead of Node, and the renderer becomes whatever WebKit your operating system already ships (WKWebView on macOS, WebKitGTK 6 on Linux). All of it is pure `bun:ffi` with **zero compiled native code** in the framework.

## The part worth paying attention to

Most "lighter Electron" projects are just better at gzipping. Bunmaska does something structurally different.

**A native module is a `.ts` file.**

Need to talk to a serial port, a USB device, the system keychain, IOKit, or anything else the OS exposes? In Electron this usually means `node-gyp`, N-API, `electron-rebuild`, and hoping the prebuilts match your exact Electron version forever. In Bunmaska you write a small TypeScript file that `dlopen`s `libSystem`, `libc`, or `IOKit` and calls it directly. No compiler. No build step. No ABI compatibility matrix. No Python summoning ritual when you upgrade.

This is not a roadmap item. It is how Bunmaska itself is built — thirty-plus system libraries wired with **zero** `cc` calls anywhere in the tree.

Add the fact that we ship **no browser engine at all**, and your updates stop being hostage situations, your users stop getting Chromium CVEs that have nothing to do with your code, and your laptop fan gets a long-overdue vacation. Buildless native extensibility plus no engine tax — that's the part no amount of tree-shaking inside a bundled Chromium can give you.

The smaller, faster apps are a side effect of all that, not the pitch. But since you asked: a packaged Bunmaska app is roughly a **16–23 MB download** and lands at about **61 MB on disk** once Bun unpacks itself. The equivalent minimal Electron app starts north of 150 MB. We measured it; we are allergic to lying in README files.

## Install

```sh
npm i bunmaska     # or: bun add bunmaska
```

You need [Bun](https://bun.sh) ≥ 1.3 (yes, that is the entire point). It is genuinely alpha, so pin your version and keep your expectations friendly. Want to hack on it directly instead?

```sh
git clone https://github.com/ipfizz/bunmaska.git
cd bunmaska && bun install
```

## Quick start

```ts
import { app, BrowserWindow } from 'bunmaska';

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    title: 'Hello Bunmaska',
  });
  win.loadURL('https://example.com');
});
```

Run it with `bun run main.ts`, or use the CLI:

```sh
bunmaska init my-app     # scaffold a starter (main + preload + renderer + config)
bunmaska dev             # run with file watching and auto-restart
bunmaska build           # produce a distributable for the current OS
```

The CLI is *your* dev tool — it never ships. `bunmaska build` hands you a standalone executable (a `.app`/`.dmg` on macOS, an AppDir/`.deb` on Linux) your users double-click; they never install `bunmaska` or open a terminal.

## What works

On **macOS** and **Linux** today you get real native windows, system WebKit rendering, full Electron-style IPC with context isolation, application and context menus, tray icons, dialogs, clipboard (text + HTML + images), `nativeImage`, `safeStorage`, `powerMonitor`, `printToPDF`, `capturePage`, and a growing list of other modules — all pure `bun:ffi`. Held together with optimism, `strict: true`, and roughly 1,600 tests that were green the last time CI ran.

| OS | Status |
|---|---|
| **macOS** | Ships — AppKit + WKWebView via `objc_msgSend`, pure `bun:ffi`. Uses the system WebKit; nothing extra to install. |
| **Linux** | Ships — GTK 4 + WebKitGTK 6 via `dlopen`. Uses the system WebKit; nothing extra to install. |
| **Windows (alpha)** | A from-scratch Win32 + WinCairo-WebKit backend — the real WebKit port, **never** WebView2/Chromium. Green on a `windows-latest` CI runner (x64), but **not turnkey**: Windows ships no system WebKit, so it needs a self-built WinCairo engine (none hosted yet), and `printToPDF` / `capturePage` / custom protocols still throw a clear "not yet." It's real — it's WebKit all the way down — it's just not finished. |

## The honest trade-offs

We are not going to sell you a fantasy.

- **Single process.** No Chromium sandbox, no per-window crash isolation. A nasty WebKit or JavaScriptCore crash takes the whole app with it. This is the architectural price of the lightness.
- **~70–80% weighted API parity** for the things most real apps actually use. The long tail (`BrowserView`, sync IPC, Web Serial/WebHID/WebUSB *from the renderer*, deeply Chromium-internal surfaces) is either out of scope by design or throws a clear error so you know immediately what's missing.
- **Windows is in the build, not done** (see the table above). macOS and Linux are where to start.

## Migrating from Electron

Change your imports:

```ts
// Before
import { app, BrowserWindow, ipcMain } from 'electron';

// After
import { app, BrowserWindow, ipcMain } from 'bunmaska';
// or the explicit shim that throws helpful errors on unimplemented modules:
import { app, BrowserWindow } from 'bunmaska/electron';
```

Most core modules behave the same. Anything not yet implemented throws an actionable error naming the exact missing module, instead of failing mysteriously at 2 a.m. One detail worth knowing up front: Web Serial, WebHID, and WebUSB are Chromium-only — system WebKit doesn't expose them — so renderer code using them needs to move to the main process and cross IPC (which, conveniently, is exactly where Bunmaska makes talking to hardware via FFI much more pleasant than the old `node-gyp` dance).

## Status

**Alpha** — `0.1.0-alpha.3`. If you are already running this in production, we admire your courage and decline all responsibility. If you are a large company doing an evaluation, please read the word "alpha" three more times before proceeding. If it is still 2027 and this file still opens with "alpha," feel free to open an issue titled "are you OK".

## Documentation

Everything deeper — the full API surface, the CLI, the pinned-WebKit engine store, packaging, and auto-update — lives at **[bunmaska.org](https://bunmaska.org)**.

## Contributing

You somehow found this repo before we told anyone. Hello. Open an issue, keep your expectations realistic, and try not to be a jerk. A proper contributing guide will exist once the project is less "held together with optimism." The docs site lives in [`website/`](./website); the framework is this repo's root and publishes to npm as `bunmaska`.

## License

[MIT](./LICENSE). Go wild.

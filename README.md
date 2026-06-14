# Bun Maska

> Dip your Electron in some fresh Bun Maska. Built on Bun and your operating system's own WebKit, because shipping 150 MB of Chromium with every desktop app is one of those ideas that made sense in 2013 and has been quietly ruining lives ever since.

## What

A **drop-in replacement for Electron** that refuses to bundle an entire browser engine just so you can put a web page in a native window.

You keep writing against the APIs you already know (`app`, `BrowserWindow`, `ipcMain`, `ipcRenderer`, `Menu`, `dialog`, `clipboard`, `webContents.printToPDF`, `capturePage`, etc.). We swap the heavy parts: runtime becomes Bun instead of Node, renderer becomes whatever WebKit your operating system already ships (WKWebView on macOS, WebKitGTK 6 on Linux). The result is dramatically smaller apps, zero compiled native code in your dependency tree, and a native module system that is just TypeScript calling `dlopen`.

## The part worth paying attention to

Most "lighter Electron" projects are just better at gzipping. Bun Maska does something structurally different.

**A native module is a `.ts` file.**

Need to talk to a serial port, USB device, system keychain, IOKit, a custom sensor, or anything else the OS exposes? In Electron this usually means `node-gyp`, N-API, `electron-rebuild`, and hoping the prebuilts match your exact Electron version forever. In Bun Maska you write a small TypeScript file that `dlopen`s `libSystem`, `libc`, or `IOKit` and calls it directly. No compiler. No build step. No ABI compatibility matrix. No Python summoning ritual when you upgrade.

This is not a roadmap item. It is how Bun Maska itself is built — thirty-plus system libraries wired with **zero** `cc` calls anywhere in the tree.

Add the fact that we ship **no browser engine at all**, and your updates stop being hostage situations, your users stop getting Chromium CVEs that have nothing to do with your code, and your laptop fan gets a long-overdue vacation.

That combination — buildless native extensibility + no engine tax — is the thing no amount of tree-shaking inside a bundled Chromium can ever give you.

## Why (the non-marketing reasons)

Your laptop fan has strong opinions about RAM. Your users have data caps and limited patience. And we are allergic to lying in README files.

Honest measured numbers: a packaged Bun Maska app is roughly a **16–23 MB download** and lands at about **61 MB on disk** once Bun unpacks itself. The equivalent minimal Electron app starts north of 150 MB and only grows from there. Updates are tiny because there is no 150 MB engine to re-download. Your OS already patches WebKit. We do not make you participate in the Chromium CVE re-shipping treadmill.

## Status

**Alpha.** Held together with optimism, `strict: true`, and 1,380 tests that were green the last time CI ran.

It works properly on both **macOS** and **Linux** today. You get real native windows, system WebKit rendering, full Electron-style IPC with context isolation, application and context menus, tray icons, dialogs, clipboard (text + HTML + images), `nativeImage`, `safeStorage`, `powerMonitor`, `printToPDF`, `capturePage`, and a growing list of other modules — all implemented with pure `bun:ffi` and zero compiled code in the framework.

There is also a CLI that scaffolds projects, runs them with hot reload, and packages real distributables (`.app`/`.dmg` on macOS, AppDir + `.deb` on Linux) with optional auto-update support.

If you are already running this in production, we admire your courage and decline all responsibility. If you are a large company doing an evaluation, please read the word "alpha" three more times before proceeding. If it is still 2027 and this file still opens with the word "alpha", feel free to open an issue titled "are you OK".

## The honest trade-offs

We are not going to sell you a fantasy.

- **Single process.** No Chromium sandbox. No per-window crash isolation. A nasty WebKit or JavaScriptCore crash takes the whole app with it. This is the architectural price of the lightness.
- **No Windows support yet.** We are waiting for a usable WebKit port on Windows that does not involve shipping Chromium. We are aware this is a hill. We are comfortable dying on it.
- **~70–80% weighted API parity** for the things most real apps actually use. The long tail (`BrowserView`, sync IPC, Web Serial/WebHID/WebUSB from the renderer, deeply Chromium-internal surfaces) is either out of scope by design or will throw a clear error so you know immediately what is missing.

## Platforms

| OS      | Status                                                                 |
|---------|------------------------------------------------------------------------|
| macOS   | Actively developed — AppKit + WKWebView via `objc_msgSend` and hand-built ObjC blocks |
| Linux   | Actively developed — GTK 4 + WebKitGTK 6 via `dlopen`                  |
| Windows | Deferred. We will not ship Chromium.                                   |

## Install

```sh
bun add bunmaska     # or: npm i bunmaska
```

Genuinely alpha — so pin your version and keep your expectations friendly. You need [Bun](https://bun.sh) ≥ 1.3 (yes, that is the entire point). Want to hack on it directly instead? Clone it:

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
    title: 'Hello Bun Maska'
  });
  win.loadURL('https://example.com');
});
```

Run it with `bun run main.ts` (or `bunmaska run main.ts` once you have the CLI).

## The CLI

```sh
bunmaska init my-app     # scaffold a full starter (main + preload + renderer + config)
bunmaska dev             # run with file watching and auto-restart
bunmaska run main.ts     # just run it
bunmaska build           # produce distributables for the current OS
bunmaska build --update  # also emit the auto-update feed (update.json + .tar.zst)
```

## Migrating from Electron

Change your imports:

```ts
// Before
import { app, BrowserWindow, ipcMain } from 'electron';

// After
import { app, BrowserWindow, ipcMain } from 'bunmaska';
// or use the explicit shim that throws helpful errors on unimplemented modules:
import { app, BrowserWindow } from 'bunmaska/electron';
```

Most core modules behave the same. Anything not yet implemented throws an actionable error naming the exact missing module instead of failing mysteriously at 2 a.m.

One migration detail worth knowing up front: Web Serial, WebHID, and WebUSB are Chromium-only. System WebKit does not expose them. If your app uses them from the renderer, that code needs to move to the main process and cross IPC (which, conveniently, is exactly where Bun Maska makes talking to hardware via FFI much more pleasant than the old `node-gyp` dance).

## Contributing

You somehow found this repo before we told anyone. Hello.

Open an issue. Keep your expectations realistic. Try not to be a jerk. A proper contributing guide will exist once the project is less "held together with optimism."

## License

[MIT](./LICENSE). Go wild.

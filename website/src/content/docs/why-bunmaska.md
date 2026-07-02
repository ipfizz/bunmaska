---
title: Why Bunmaska
description: Because shipping a whole browser engine with every desktop app is how we ended up with 14 GB of RAM disappearing into a chat window.
order: 2
---

Everyone's "lighter Electron" pitch is "we made the binary smaller." Cute. Anyone can gzip a binary. Here is the thing Electron **structurally cannot do**, and it's the reason Bunmaska exists.

## The runtime is Bun, and it shows

Your main process runs on [Bun](https://bun.sh), not Node - and that's not a detail:

- **Millisecond startup.** Bun boots several times faster than Node, and JavaScriptCore (the engine behind Safari) is tuned for exactly that - fast start, lean memory. Your app window appears before Electron has finished unpacking itself.
- **TypeScript is the native language.** `bunmaska run src/main.ts` executes your TS directly - no transpile step, no build config, no `ts-node` tax.
- **The toolchain collapses to one binary.** Package manager, bundler, test runner and `bun build --compile` all ship inside Bun - it's how the CLI packages your whole app into a single executable with no electron-builder in sight.
- **`bun:ffi` is the moat-maker.** The same FFI that makes native modules buildless (next section) is a first-class, JIT-optimized part of the runtime - not an addon system bolted on later.

## A native module is just a `.ts` file

Want to talk to a USB serial port, the system keychain, IOKit, a custom sensor - anything the OS exposes? In Electron that means `node-gyp`, N-API, `electron-rebuild`, and a per-arch prebuild matrix that detonates every time you bump Electron.

In Bunmaska, a native module is a TypeScript file that `dlopen`s the operating system and calls it directly. No compiler. No `binding.gyp`. No recompile when you upgrade. It's [literally how Bunmaska itself is built](/docs/native-modules/overview) - about thirty system libraries wired with zero compiled native code.

> Nothing to rebuild, because there was never anything to build.

## The engine is a choice, not a tax

Electron has one engine story: a private Chromium in every app, re-shipped with every update. Bunmaska gives you three, all WebKit, all outside your update pipeline:

- **Default - the system's WebKit** (macOS `WKWebView`, Linux WebKitGTK). Nothing extra to download; the OS patches the browser engine for you, while you sleep.
- **Pinned - an exact, signature-verified WebKit build** from the shared [engine store](/docs/concepts/engine), when byte-for-byte rendering consistency matters. Installed once, shared across every app that pins it - "tested == shipped" without Electron's per-app copy.
- **Windows - our own from-source WinCairo build** (Windows ships no WebKit). Still WebKit, never Chromium, and loaded from the same store instead of living inside your bundle.

Whichever you pick, the result is the same: **your app update is your code, not a browser.**

- **~3× smaller installed** and **~7-10× smaller to download** than the Electron equivalent.
- Updates are tiny - there's no 150 MB Chromium to re-ship every release.
- Engine security updates arrive with the OS or the engine store - never as a rebuild of your app.

| | Electron | Bunmaska |
| --- | --- | --- |
| Download | 150 MB+ | **~16-23 MB** |
| Installed | ~220 MB | **~60 MB** |
| Runtime deps | several | **zero** |
| Compiled native code | a lot | **none** |

## Supply-chain minimalism

Zero runtime dependencies. Zero compiled native code. No postinstall build scripts. No per-arch prebuilt addons to vet. Your runtime SBOM is "Bun + your code." For anyone who's had to fill out a vendor security review, that sentence is worth a lot.

## And the honest part

It's alpha, it runs on macOS, Linux, and Windows x64 (a few APIs differ per platform), and it covers ~70-80% of Electron's surface. We're not going to pretend otherwise - that's a whole [page of trade-offs](/docs/migrating/parity), published on purpose. If you need Windows ARM64, `BrowserView`, or the last 20% of the API, Bunmaska isn't there yet.

If you want a desktop app that's small, fast, and doesn't ship a browser it didn't need to - that's the entire point.

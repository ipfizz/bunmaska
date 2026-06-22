---
title: Why Bunmaska
description: Because shipping a whole browser engine with every desktop app is how we ended up with 14 GB of RAM disappearing into a chat window.
order: 2
---

Everyone's "lighter Electron" pitch is "we made the binary smaller." Cute. Anyone can gzip a binary. Here is the thing Electron **structurally cannot do**, and it's the reason Bunmaska exists.

## A native module is just a `.ts` file

Want to talk to a USB serial port, the system keychain, IOKit, a custom sensor - anything the OS exposes? In Electron that means `node-gyp`, N-API, `electron-rebuild`, and a per-arch prebuild matrix that detonates every time you bump Electron.

In Bunmaska, a native module is a TypeScript file that `dlopen`s the operating system and calls it directly. No compiler. No `binding.gyp`. No recompile when you upgrade. It's [literally how Bunmaska itself is built](/docs/native-modules/overview) - about thirty system libraries wired with zero compiled native code.

> Nothing to rebuild, because there was never anything to build.

## No engine to ship, patch, or re-download

Because we ship **no browser engine at all**:

- Your app is **~3× smaller installed** and **~7-10× smaller to download** than the Electron equivalent.
- Your updates are tiny - there's no 150 MB Chromium to re-download every release.
- You don't chase Chromium CVEs. Your OS patches WebKit for you, while you sleep.

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

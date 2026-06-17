---
title: Building & Distribution
description: Turn your app into real, shippable distributables for every platform Bunmaska supports - .dmg on macOS, AppDir and .deb on Linux, x64 and ARM.
order: 5
---

`bunmaska build` compiles your app with `bun build --compile`, bundles it next to the Bun runtime, and emits native distributables. There's **no Chromium to ship**, so the outputs are small and the build is fast - no Xcode project, no `electron-builder`.

## Build your app

From your project root:

```sh
bunmaska build
```

This produces distributables **for the operating system you run it on**. Build macOS artifacts on a Mac, Linux artifacts on Linux. (Bunmaska bundles a system-WebKit `dlopen`, so a build is "your compiled code + the Bun runtime" - there is no engine to cross-ship.)

## macOS

```sh
bunmaska build                 # → MyApp.app + MyApp.dmg
```

You get:

- **`.app` bundle** - with a `.icns` icon converted from your PNG.
- **`.dmg`** - the drag-to-Applications disk image.
- **Code signing & notarization** (optional but recommended for distribution):

```sh
# Sign with your Developer ID, then notarize with Apple
APPLE_ID="you@example.com" \
TEAM_ID="XXXXXXXXXX" \
BUNMASKA_NOTARIZE_PASSWORD="app-specific-password" \
bunmaska build --sign --notarize
```

A signed + notarized app passes macOS Gatekeeper without a warning. (Requires an Apple Developer account - $99/yr, one account, unlimited apps.)

### Architectures

Build on the architecture you're targeting: an **Apple Silicon** Mac produces `arm64`, an **Intel** Mac produces `x64`. To target the other arch, build on a machine (or CI runner) of that arch.

## Linux

```sh
bunmaska build                 # → AppDir (.tar.gz) + MyApp.deb
```

You get:

- **AppDir `.tar.gz`** - a relocatable directory bundle.
- **`.deb`** - for Debian/Ubuntu and derivatives (the `ar` archive is assembled in pure JS - no `dpkg` toolchain required to produce it).

> The generated `.deb` declares `libwebkitgtk-6.0` as a dependency, so a user's `apt install` pulls the engine in automatically - you don't ship it, and they don't hunt for it. Bunmaska never bundles a browser.

### Architectures

Build on the target architecture: an `x64` box produces `x64`, an **ARM64** box (including a **Raspberry Pi**) produces `arm64`. The same command, no cross-compile gymnastics.

## Windows

Not available yet - see [Platform Support](/docs/platforms) and the [roadmap](/roadmap). When WinCairo support lands, `bunmaska build` will gain Windows targets.

## Auto-updates

Add `--update` to also emit the update feed your app's `autoUpdater` consumes:

```sh
bunmaska build --update --channel stable
```

This writes a content-hashed `<name>-<channel>-<os>-<arch>.tar.zst` plus an `update.json` manifest alongside your build. Because there's no 150 MB engine inside, **update payloads are tiny** - users download your code, not a browser. Wire it up in your app:

```ts
import { autoUpdater } from "bunmaska";

autoUpdater.setFeedURL({ url: "https://downloads.example.com" });
autoUpdater.on("update-downloaded", () => autoUpdater.quitAndInstall());
autoUpdater.checkForUpdates();
```

> `quitAndInstall`'s final atomic swap-and-relaunch is still experimental in alpha - the check / download / verify / stage engine is solid.

## A note on signing & trust

For a distribution users will trust on first launch:

- **macOS:** Developer ID signing + notarization (above).
- **Linux:** ship the `.deb` from a repo or a signed release; users get the engine from their package manager.

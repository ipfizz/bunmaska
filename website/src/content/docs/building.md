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

The entry comes from your `bunmaska.config.ts` (pass it explicitly - `bunmaska build src/main.ts` - if you prefer). By default this targets **the operating system you run it on**; `--target macos|linux|windows` cross-builds from another host (a macOS `.app` still needs a macOS host for codesign). A build is "your compiled code + the Bun runtime" - on macOS and Linux there is no engine to ship at all.

## macOS

```sh
bunmaska build                 # > MyApp.app
bunmaska build --dmg           # > MyApp.app + MyApp.dmg
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
bunmaska build --sign "Developer ID Application: Your Name (TEAMID)" --notarize
```

`--notarize` zips the signed `.app`, submits it via `xcrun notarytool --wait`, and staples the ticket. If the three env vars above are missing it is skipped with a message telling you which ones to set, rather than failing the build. A signed + notarized app passes macOS Gatekeeper without a warning. (Requires an Apple Developer account - $99/yr, one account, unlimited apps.)

### Architectures

Build on the architecture you're targeting: an **Apple Silicon** Mac produces `arm64`, an **Intel** Mac produces `x64`. To target the other arch, build on a machine (or CI runner) of that arch.

## Linux

```sh
bunmaska build                 # > AppDir (.tar.gz) + MyApp.deb
```

You get:

- **AppDir `.tar.gz`** - a relocatable directory bundle.
- **`.deb`** - for Debian/Ubuntu and derivatives (the `ar` archive is assembled in pure JS - no `dpkg` toolchain required to produce it).

> The generated `.deb` declares `libwebkitgtk-6.0` as a dependency, so a user's `apt install` pulls the engine in automatically - you don't ship it, and they don't hunt for it. Bunmaska never bundles a browser.

### Architectures

Build on the target architecture: an `x64` box produces `x64`, an **ARM64** box (including a **Raspberry Pi**) produces `arm64`. The same command, no cross-compile gymnastics.

## Windows

`bunmaska build --target windows` compiles a self-contained `.exe` and packages it as a `.zip` (x64). Because Windows ships no system WebKit, the app needs a **WinCairo `WebKit2.dll`** - today you build that from WebKit source and embed it (`--embed-engine`, or point `BUNMASKA_WEBKIT_PATH` at a build). A hosted prebuilt engine - so you don't have to build it yourself - is the next step. See [Platform Support](/docs/platforms) and the [roadmap](/roadmap).

## Bundling your renderer

If your renderer is more than a static `index.html` - React, TypeScript, anything that needs a bundler - Bunmaska can own that build. Declare it in `bunmaska.config.ts`:

```ts
import { defineConfig } from 'bunmaska/config';

export default defineConfig({
  name: 'MyApp',
  entry: 'src/main.ts',
  renderer: {
    entry: 'src/renderer/main.tsx',          // your renderer entry
    outDir: 'dist/renderer',                 // default: dist/renderer
    copy: ['src/renderer/index.html'],       // static files copied in verbatim
  },
});
```

With that block in place:

- **`bunmaska dev`** builds the renderer up front, then **rebuilds and live-reloads** the open windows when you edit anything under the renderer entry's directory - a React component edit no longer restarts the whole app. A broken edit prints the bundler error and keeps the dev loop alive.
- **`bunmaska build`** builds the renderer first and ships the output as a `renderer/` directory beside the executable, on all three platforms. Point `loadFile` at it the same way the scaffold resolves its assets (next to the entry in dev, next to `process.execPath` when packaged).

### Why the output looks the way it does

Two deliberate choices, both forced by how a desktop renderer actually loads. If you bring your own bundler instead, you will need the same two settings:

- **A classic IIFE bundle, not ES modules.** `loadFile` serves your page over `file://`, and browsers treat `file://` as a null origin - a `<script type="module">` fails the CORS check and silently loads nothing. A classic script has no such rule, so the bundle is one IIFE your `index.html` includes with a plain `<script src>`.
- **`NODE_ENV=development` baked into the bundle.** Bun's bundler transpiles JSX to `jsxDEV` calls regardless of your tsconfig, and React's *production* runtime stubs `jsxDEV` out - the combination renders a blank page with no error. Defining `process.env.NODE_ENV` as `development` selects the React runtime that actually implements what Bun emits.

The `renderer` block is optional: apps with their own bundler setup (Vite, etc.) just keep running it themselves and let `bunmaska dev` live-reload on the output writes - `dist/` is watched.

## Auto-updates

`bunmaska build` can emit a signed update feed, and the runtime `autoUpdater` consumes it. The whole pipeline is four steps.

**1. Generate a signing key pair (once):**

```sh
bunmaska keygen
```

This writes `update-signing-key.pem` (private - signs releases, never ships in the app; keep it out of git) and `update-public-key.pem` (bake it into your app).

**2. Build with `--update` and sign the artifact:**

```sh
bunmaska build --update --update-key update-signing-key.pem --channel stable
```

This writes a content-hashed `<name>-<channel>-<os>-<arch>.tar.zst`, an `update.json` manifest, and a detached `.sig` alongside your build. Skipping `--update-key` prints a loud warning and produces an unsigned feed **the runtime autoUpdater will refuse** - fine for a smoke test, useless for shipping. Because there's no 150 MB engine inside, update payloads are tiny: users download your code, not a browser.

**3. Host the three files** (`update.json`, the `.tar.zst`, the `.sig`) in one https directory - any static host or object store works.

**4. Wire it up in your app**, with the public key baked in:

```ts
import { autoUpdater } from "bunmaska";

autoUpdater.setFeedURL({
  url: "https://downloads.example.com/myapp/stable",
  publicKey: UPDATE_PUBLIC_KEY_PEM, // contents of update-public-key.pem
});
autoUpdater.on("update-available", () => autoUpdater.downloadUpdate());
autoUpdater.on("update-downloaded", () => autoUpdater.quitAndInstall());
autoUpdater.checkForUpdates();
```

`downloadUpdate` verifies size, content hash, and the Ed25519 signature before staging; `quitAndInstall` performs a real swap - a detached helper waits for the app to exit, extracts into a temp sibling, rename-swaps the bundle into place, and relaunches. See the [autoUpdater reference](/docs/api/auto-updater) for the full contract and its honest caveats (it refuses to swap a non-installed layout, and the live swap is the one step CI doesn't exercise end to end).

## A note on signing & trust

For a distribution users will trust on first launch:

- **macOS:** Developer ID signing + notarization (above).
- **Linux:** ship the `.deb` from a repo or a signed release; users get the engine from their package manager.

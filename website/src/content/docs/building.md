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

The entry comes from your `bunmaska.config.ts` (pass it explicitly - `bunmaska build src/main.ts` - if you prefer). By default this targets **the operating system you run it on**; `--target macos|linux|windows` cross-builds from another host (a macOS `.app` still needs a macOS host for codesign). A build is "your compiled code + the Bun runtime" - on macOS and Linux there is no engine to ship at all. Each build replaces its earlier output, so a file you deleted stops shipping.

### What ships beside the executable

`bunmaska build` copies the files that sit beside your entry file (recursively) next to the executable, but only these types: `.html`/`.htm`, `.js`/`.mjs`/`.cjs`, `.css`, `.json`, `.wasm`, `.txt`, images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.avif`, `.ico`, `.icns`, `.bmp`), fonts (`.woff`, `.woff2`, `.ttf`, `.otf`), media (`.mp3`, `.mp4`, `.m4a`, `.aac`, `.wav`, `.ogg`, `.webm`, `.flac`) and native libraries (`.dylib`, `.so`, `.dll`). Dotfiles, dot directories and `node_modules` never ship. It is an allowlist on purpose: the update-signing key or a `.env` that happens to live next to your entry stays home.

A `preload.js` / `.mjs` / `.cjs` among those files is bundled into a classic script on the way (a compiled app cannot bundle at runtime), so it may `import` freely. A `.ts` preload does not ship - name it `preload.js`.

## macOS

```sh
bunmaska build                 # > MyApp.app
bunmaska build --dmg           # > MyApp.app + MyApp.dmg
```

You get:

- **`.app` bundle** - named from `--name`, else `name` in `bunmaska.config.ts`, else the entry file's stem - with a `.icns` icon converted from your PNG. Its `Info.plist` carries your `package.json` version and requires **macOS 13 or later**, the oldest macOS a Bun-compiled binary loads on.
- **`.dmg`** - the drag-to-Applications disk image. With `--notarize` it is built after notarization, so it wraps the stapled app.
- **Code signing & notarization** (optional but recommended for distribution):

```sh
# Sign with your Developer ID, then notarize with Apple
APPLE_ID="you@example.com" \
TEAM_ID="XXXXXXXXXX" \
BUNMASKA_NOTARIZE_PASSWORD="app-specific-password" \
bunmaska build --sign "Developer ID Application: Your Name (TEAMID)" --notarize
```

`--notarize` requires `--sign` with a Developer ID identity; the build refuses a missing or ad-hoc (`-`) signature up front, since Apple rejects both, rather than letting you find out after a full compile. Signing with a real identity requests a secure timestamp, which notarization demands. `--notarize` zips the signed `.app`, submits it via `xcrun notarytool --wait`, and staples the ticket. If the three env vars above are missing it is skipped with a message telling you which ones to set, rather than failing the build. A signed + notarized app passes macOS Gatekeeper without a warning. (Requires an Apple Developer account - $99/yr, one account, unlimited apps.)

### Architectures

Build on the architecture you're targeting: an **Apple Silicon** Mac produces `arm64`, an **Intel** Mac produces `x64`. To target the other arch, build on a machine (or CI runner) of that arch.

## Linux

```sh
bunmaska build                 # > <Name>-linux-<arch>.tar.gz + <slug>_<version>_<arch>.deb
```

You get:

- **`<Name>-linux-<arch>.tar.gz`** - a relocatable AppDir bundle. The binary and its assets live together in `usr/lib/<slug>/`, and `usr/bin/<slug>` is a relative link to the binary, so a `.deb` install puts only that one link in the shared `/usr/bin`.
- **`<slug>_<app-version>_<arch>.deb`** - the app version comes from your project's `package.json` (`0.0.0` if absent), with a prerelease dash turned into `~` so `1.0.0-beta.1` sorts below `1.0.0` the way Debian expects; for Debian/Ubuntu and derivatives (the `ar` archive is assembled in pure JS - no `dpkg` toolchain required to produce it).

> The generated `.deb` depends on `libwebkitgtk-6.0-4 (>= 2.42)` and `libgtk-4-1 (>= 4.10)` (and recommends `libnotify4` for notifications), so a user's `apt install` pulls the engine in automatically - you don't ship it, and they don't hunt for it. Those are the [GTK and WebKitGTK floors](/docs/platforms#linux) the runtime needs, so a distro too old to run your app refuses the package instead of letting it crash at launch. Bunmaska never bundles a browser.

### Architectures

The build targets the host architecture: an `x64` box produces `x64`, an **ARM64** box (including a **Raspberry Pi**) produces `arm64`. The same command, no cross-compile gymnastics.

## Windows

`bunmaska build --target windows` compiles a self-contained `.exe` into a portable `<Name>/` directory and zips it (x64). Because Windows ships no system WebKit, the app needs a **WinCairo `WebKit2.dll`**, and without one it refuses to start. To ship one, embed it: `--embed-engine <dir>`, or `engine.embed: true` with an installed engine pin (`bunmaska engine install <id>` first). On a dev machine, a pinned engine in the store or `BUNMASKA_WEBKIT_PATH` also works. Only a Windows host can stamp the `.exe` icon and version info; a cross-build from macOS or Linux leaves them out and says so. The stable-train build and ARM64 are next. See [Platform Support](/docs/platforms) and the [roadmap](/roadmap).

## The engine pin

`engine.webkit` in `bunmaska.config.ts` is baked into Linux and Windows bundles, so the app resolves that engine at launch. On macOS it is **not** baked - macOS always runs the system WKWebView today; pinning there is on the [roadmap](/roadmap). A bare upstream version like `2.52.4` is not resolved yet: `build` bakes `system` and warns (so do `dev` and `run`), so pin a full engine id (see [Pinned WebKit Engine](/docs/concepts/engine)). A malformed pin or an unknown config key fails the config load outright.

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
- **`bunmaska build`** builds the renderer first and ships the output as a `renderer/` directory beside the executable, on all three platforms. In dev the output stays in `outDir` (`dist/renderer` by default) under the project, so point `loadFile` at whichever applies:

```ts
import { dirname, join } from 'node:path';
import { app } from 'bunmaska';

const rendererDir = app.isPackaged
  ? join(dirname(process.execPath), 'renderer')
  : join(app.getAppPath(), 'dist/renderer');
win.loadFile(join(rendererDir, 'index.html'));
```

### Why the output looks the way it does

Two deliberate choices, both forced by how a desktop renderer actually loads. If you bring your own bundler instead, you will need the same two settings:

- **A classic IIFE bundle, not ES modules.** `loadFile` serves your page over `file://`, and browsers treat `file://` as a null origin - a `<script type="module">` fails the CORS check and silently loads nothing. A classic script has no such rule, so the bundle is one IIFE your `index.html` includes with a plain `<script src>`.
- **`NODE_ENV` follows the command.** `bunmaska dev` defines `process.env.NODE_ENV` as `development` (the React development runtime, warnings and `jsxDEV`); `bunmaska build` defines `production`. Bun picks the matching JSX runtime from that define, so a `react-jsx` tsconfig needs nothing else.

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

This writes a content-hashed `<name>-<channel>-<os>-<arch>.tar.zst`, an `update.json` manifest (its version is read from your project's `package.json`), and a detached Ed25519 signature for each: `update.json.sig` and `<artifact>.sig`. `--channel` defaults to `updates.channel` in your config, else `stable`; `--update-key` and `--channel` without `--update`, or a key file that is not a private key, fail before anything is built. Skipping `--update-key` prints a loud warning and produces an unsigned feed **the runtime autoUpdater will refuse** - fine for a smoke test, useless for shipping. Because there's no 150 MB engine inside, update payloads are tiny: users download your code, not a browser.

**3. Host the four files** (`update.json`, `update.json.sig`, the `.tar.zst` and its `.sig`) in one https directory - any static host or object store works.

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

`downloadUpdate` verifies the manifest's signature, then the artifact's size, content hash and signature, before staging; `quitAndInstall` performs a real swap - a detached helper waits for the app to exit, extracts into a temp sibling, rename-swaps the bundle into place, and relaunches. See the [autoUpdater reference](/docs/api/auto-updater) for the full contract and its honest caveats (it refuses to swap a non-installed layout, and the live swap is the one step CI doesn't exercise end to end).

## A note on signing & trust

For a distribution users will trust on first launch:

- **macOS:** Developer ID signing + notarization (above).
- **Linux:** ship the `.deb` from a repo or a signed release; users get the engine from their package manager.

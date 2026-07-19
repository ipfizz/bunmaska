---
title: The Engine Repository
description: "Which WebKit engines bunmaska hosts, for which platforms, and how to install a pinned engine from the feed - the live, signed engine repository at engines.bunmaska.org."
seoTitle: "bunmaska engine repository - hosted WebKit engines per platform"
keywords: ["webkit engine store", "pin webkit version desktop app", "bunmaska engine install"]
order: 4
---

The **engine repository** is the signed feed bunmaska publishes pinned WebKit engines to, at **`https://engines.bunmaska.org`**. It's the hosted half of the [pinned-engine model](engine.md): an app declares the exact engine-id it was tested against, and that engine is fetched, signature-verified, and installed side by side with any others. "Tested == shipped", for real, from the cloud.

You almost never think about it. Most apps use your operating system's own WebKit and download nothing. The repository matters on the one platform that has no system WebKit - Windows - and as an opt-in on Linux.

## Do I even need a hosted engine? (per platform)

| Platform | Default engine | Hosted engine |
| --- | --- | --- |
| **macOS** | System WKWebView - ships with the OS, nothing to download. | Not needed (and not published). |
| **Linux** | System WebKitGTK 6 - installed via your package manager. | Optional pin, for exact-version reproducibility (a relocatable Linux engine is on the roadmap). |
| **Windows** | None - Windows has no system WebKit. | **Required.** Windows always runs a bunmaska-built WinCairo WebKit, from the feed or embedded in the app. |

So the repository is **Windows-first**: today it hosts the WinCairo engine that Windows apps need. macOS and Linux ride their system WebKit unless you deliberately pin.

## Which engines are available

The live list is a machine-readable index at **`https://engines.bunmaska.org/index.json`** - the single source of truth (this page never hardcodes versions, so it can't go stale). Read it from the CLI:

```sh
bunmaska engine available
```

```
Engines on the feed (this machine is windows/x64). * = installed, > = matches this machine:
*> webkit-2-2.53.3-bunmaska1-windows-x64  (56 MB)
Install one with: bunmaska engine install <id>
```

A `*` means it's already installed locally; a `>` means it matches your OS + architecture.

### The engine-id

Every engine has a flat, content-addressed id: `<family>-<api>-<upstream>-<rev>-<os>-<arch>`, e.g. `webkit-2-2.53.3-bunmaska1-windows-x64` (WinCairo WebKit, upstream 2.53.3, bunmaska build 1, Windows x64). The id encodes exactly what you're getting, and the store keys directories on it so many versions coexist. Supported today: **Windows x64** (ARM64 is on the roadmap). Details in [the engine concept page](engine.md#the-engine-id).

## How to install one

```sh
# By bare id - resolves the official feed automatically:
bunmaska engine install webkit-2-2.53.3-bunmaska1-windows-x64

# Or from an explicit URL (self-hosted mirror, etc.):
bunmaska engine install https://engines.bunmaska.org/webkit-2-2.53.3-bunmaska1-windows-x64.tar.zst
```

The install downloads the `.tar.zst`, **verifies its Ed25519 signature** against bunmaska's baked-in release key and its content hash, checks the extracted engine's own signed `engine.json` id matches what you asked for (so a compromised mirror can't swap engines), and installs it into the shared store. Nothing runs before the signature verifies.

To pin an app to it, set it in `bunmaska.config` - then `bunmaska build` bakes the id into the bundle and the app resolves it at launch:

```ts
import { defineConfig } from "bunmaska/config";

export default defineConfig({
  engine: { webkit: "webkit-2-2.53.3-bunmaska1-windows-x64" },
});
```

Or embed the engine directly in the build (offline / airgapped, no feed at runtime):

```sh
bunmaska build --target windows --embed-engine <engine-dir>
```

## Self-hosting a mirror

The repository is a plain object store behind a tiny read-only Worker (the reference implementation is `tools/engine/feed-worker/` in the repo). To run your own - enterprise, airgapped, or a private engine build - deploy that Worker over your own bucket and point your app at it:

```ts
export default defineConfig({
  engine: {
    webkit: "webkit-2-2.53.3-bunmaska1-windows-x64",
    feed: { url: "https://engines.example.com", publicKey: "<your PEM public key>" },
  },
});
```

`bunmaska engine available` and `install` then read *your* feed's `index.json` and artifacts, verified against *your* key. See [the engine concept page](engine.md#self-hosting-an-engine-feed-advanced).

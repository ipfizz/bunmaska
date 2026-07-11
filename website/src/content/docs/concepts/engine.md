---
title: Pinned WebKit Engine
description: "Pin a signature-verified WebKit build shared across apps - a WebKit version manager for desktop apps. System WebKit by default; tested equals shipped."
seoTitle: "The engine store - pin an exact WebKit version"
order: 3
---

Bunmaska apps render on **the system's WebKit** by default - WKWebView on macOS, WebKitGTK 6 on Linux. That's the whole reason apps are tiny: there's no engine to ship. The trade-off is that the WebKit version varies from machine to machine, so "tested on my laptop" isn't quite "tested on your user's laptop."

When that matters, you can **pin the exact WebKit build you tested**. This page explains how, and is honest about where the feature actually is today.

## Not nvm - side by side

The model is Playwright's browser registry, not a version manager. There is **no global "current" engine** and no `use --global`. Every app records the engine it was built against and resolves *that one* at launch, out of a content-addressed store where many versions coexist:

```
~/.bunmaska/webkit/
  webkitgtk-6.0-2.46.0-bunmaska1-linux-x64/
  webkitgtk-6.0-2.52.4-bunmaska1-linux-x64/
```

App A on `2.46.0` and App B on `2.52.4` run at the same time, each loading its own. The engine is downloaded once and **shared by every app that pins it**, so the apps themselves stay single-digit megabytes.

## Pinning an engine

Pin it per-project in your config:

```ts
import { defineConfig } from "bunmaska/config";

export default defineConfig({
  engine: { webkit: "webkitgtk-6.0-2.52.4-bunmaska1-linux-x64" },
});
```

`engine.webkit` accepts a full engine-id, a bare upstream version like `"2.52.4"`, or `"system"` (the default - use the OS WebView, no pinning). At `bunmaska build`, the resolved id is baked into the bundle, so the pin travels with the app and is read at launch.

### The engine-id

A flat, content-addressed string - `<engine>-<api>-<upstream>-<rev>-<os>-<arch>`:

```
webkitgtk-6.0-2.52.4-bunmaska1-linux-x64
```

The `upstream` field is the actual WebKit release (the thing that changes how pages render); `rev` is Bunmaska's build of it. The id is both the store directory name and the lookup key.

## What happens at launch

The app reads the engine-id it was **built against** - baked into the bundle from your `bunmaska.config` pin. It resolves that engine from the store, and if it isn't installed, the app **falls back to the system WebKit and says so on stderr** - it still launches, but it tells you the tested-build guarantee isn't being met. Pinning should never be the reason your app won't start.

You configure all of this in `bunmaska.config` - there are **no environment variables to set**. (A few internal overrides exist for tests and ops, the way Playwright has `PLAYWRIGHT_BROWSERS_PATH`; you'll never need them, so they're not documented here.)

## The CLI

```sh
bunmaska engine list             # installed engines (side by side) + refcounts
bunmaska engine which [dir]      # the engine a project resolves
bunmaska engine install <id>     # an engine-id, fetched from the official feed
bunmaska engine install <path>   # a local engine directory
bunmaska engine install <url>    # a published .tar.zst - signature + hash verified
bunmaska engine use <id>         # print the per-project config to add (no --global)
bunmaska engine prune            # garbage-collect engines no installed app references
bunmaska engine verify <id>      # structural integrity check
bunmaska doctor                  # runtime, store, and the engine this project resolves
```

Remote installs verify an **Ed25519 detached signature** and the content hash before extracting anything, and the extracted engine's own signed `engine.json` id must match the id you asked for (so a compromised mirror cannot swap one signed engine in for another). The official feed's signing key is a **trust anchor baked into Bunmaska** - public, verified automatically, nothing to configure. To run a private mirror, set `engine.feed = { url, publicKey }` in `bunmaska.config`.

## Self-hosting an engine feed (advanced)

Almost nobody needs this. If you run your own engine mirror (enterprise, airgapped), point at it and supply *its* public key - in `bunmaska.config`, not an environment variable:

```ts
import { defineConfig } from "bunmaska/config";

export default defineConfig({
  engine: {
    webkit: "webkitgtk-6.0-2.52.4-bunmaska1-linux-x64",
    feed: {
      url: "https://engines.your-company.internal/",
      publicKey: "-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----",
    },
  },
});
```

That's the whole configuration surface: the pin and, if you're self-hosting, the feed. Everything else - where the store lives, how engines are resolved - is managed internally.

## Availability

Where each piece stands today:

- **The pinned-engine tier works on Linux now.** You can pin an engine, install it into the shared store, and have an app load *that* WebKit from the store instead of the system one - with its whole dependency closure self-contained.
- **Downloadable engines and the final render pass are next.** Serving prebuilt engines from a signed feed to `install`, and rendering through the relocated helper processes, are in progress; the catalog of hosted engines isn't filled in yet.
- **macOS pinning is designed** - it means shipping a signed `WebKit.framework` resolved from the store. The default stays system WKWebView; pinning is opt-in.
- **Windows brings its own WebKit (WinCairo), never WebView2** (that's Chromium). The Win32 backend ships today (beta, x64); you build the WinCairo engine from source and embed it, until the hosted feed lands.

So today the default - the system WebKit - is what nearly every app should use. The pinned tier is the opt-in path to byte-for-byte "tested == shipped."

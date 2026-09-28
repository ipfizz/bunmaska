---
title: Pinned WebKit Engine
description: "Pin a signature-verified WebKit build shared across apps - a WebKit version manager for desktop apps. System WebKit by default; tested equals shipped."
seoTitle: "The engine store - pin an exact WebKit version"
order: 3
---

Bunmaska apps render on **the system's WebKit** by default - WKWebView on macOS, WebKitGTK 6 on Linux. That's the whole reason apps are tiny: there's no engine to ship. The trade-off is that the WebKit version varies from machine to machine, so "tested on my laptop" isn't quite "tested on your user's laptop."

When that matters, you can **pin the exact WebKit build you tested**. This page explains how, and is honest about where the feature actually is today.

## Not nvm - side by side

The model is Playwright's browser registry, not a version manager. There is **no global "current" engine** and no `use --global`. Every app records the engine it was built against and resolves *that one* at launch, out of an id-addressed store where many versions coexist:

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

`engine.webkit` accepts a full engine-id or `"system"` (the default - use the OS WebView, no pinning). The schema also accepts a bare upstream version like `"2.52.4"`, but that is not resolved yet - `build` bakes `system` and warns, so use the full id. At `bunmaska build` the id is baked into Linux and Windows bundles, so the pin travels with the app and is read at launch. macOS ignores the pin: it always runs the system WKWebView today (macOS pinning is on the roadmap). An id names one OS and architecture, and a machine that doesn't match treats the pin as absent (`doctor` and `engine which` say so), so today one pin covers one platform per project. A malformed pin fails the config load.

`engine.embed: true` copies the pinned engine into the bundle on Windows (the same thing as `--embed-engine <dir>`, pointed at the store): install it first, or the build stops and tells you to. It is refused on Linux - embedding isn't built there - and does nothing on macOS.

### The engine-id

A flat string that names the build (it is an id, not a content hash) - `<engine>-<api>-<upstream>-<rev>-<os>-<arch>`:

```
webkitgtk-6.0-2.52.4-bunmaska1-linux-x64
```

The `upstream` field is the actual WebKit release (the thing that changes how pages render); `rev` is Bunmaska's build of it. The id is both the store directory name and the lookup key.

## What happens at launch

On Linux and Windows the app reads the engine-id it was **built against** - baked into the bundle from your `bunmaska.config` pin - and resolves that engine from the store.

- **Linux:** if the engine isn't installed, the app **falls back to the system WebKit and says so on stderr** - it still launches, but it tells you the tested-build guarantee isn't being met. Pinning should never be the reason your app won't start.
- **Windows:** there is no system WebKit to fall back to, so an app with no engine - none embedded, none in the store, no `BUNMASKA_WEBKIT_PATH` - fails to start with an error saying which of those to provide. Embed the engine in anything you ship (see [Shipping Your App](/docs/shipping)).

You configure all of this in `bunmaska.config` - there are **no environment variables to set** on macOS and Linux; Windows can also point at an engine with `BUNMASKA_WEBKIT_PATH`. (A few internal overrides exist for tests and ops, the way Playwright has `PLAYWRIGHT_BROWSERS_PATH`; you'll never need them, so they're not documented here.)

## The CLI

```sh
bunmaska engine list             # installed engines (side by side) + refcounts
bunmaska engine available        # engines published on the feed (see The Engine Repository)
bunmaska engine which [dir]      # the engine a project resolves
bunmaska engine install <id>     # an engine-id, fetched from the official feed
bunmaska engine install <path>   # a local engine directory
bunmaska engine install <url>    # a published .tar.zst - signature + hash verified
bunmaska engine use <id>         # print the per-project config to add (no --global)
bunmaska engine use <id> --for <dir>   # same, for a project in another directory
bunmaska engine prune            # garbage-collect engines no installed app references
bunmaska engine prune --dry-run  # preview what prune would remove
bunmaska engine prune --force    # prune even when no app has registered a dependency yet
bunmaska engine verify <id>      # structural integrity check
bunmaska doctor                  # runtime, store, and the engine this project resolves
```

Remote installs verify an **Ed25519 detached signature** and the content hash before extracting anything. The store directory is then named from the id in the extracted engine's own (signed) `engine.json`, and the install fails if that disagrees with the feed's manifest, so a compromised mirror cannot slip one signed engine in under another engine's id. The official feed's signing key is a **trust anchor baked into Bunmaska** - public, verified automatically, nothing to configure. To run a private mirror, set `engine.feed = { url, publicKey }` in `bunmaska.config`.

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

- **On Linux a pinned engine loads from the store; no Linux engine is hosted on the feed yet.** You can pin an engine, install a local build into the shared store, and have an app load *that* WebKit instead of the system one, with most of its library closure beside it. Not all of it: driver-coupled libraries such as the GPU stack stay the system's on purpose, and the helper processes are still looked up at the install path compiled into the build rather than in the store, so a pinned Linux engine is not fully self-contained yet.
- **Hosted Linux engines and the final render pass are next.** The feed serves a Windows (WinCairo) engine today (see [The Engine Repository](/docs/concepts/engine-repository)); Linux builds on the feed, and rendering through the relocated helper processes, are in progress.
- **macOS pinning is designed** - it means shipping a signed `WebKit.framework` resolved from the store. The default stays system WKWebView; pinning is opt-in.
- **Windows brings its own WebKit (WinCairo), never WebView2** (that's Chromium). The Win32 backend is in beta (x64); a hosted WinCairo engine is on the feed today (`bunmaska engine install <id>`, then `engine.embed: true`), or embed your own build with `--embed-engine`.

So today the default - the system WebKit - is what nearly every app should use. The pinned tier is the opt-in path to byte-for-byte "tested == shipped."

---
title: The CLI
description: "Scaffold, run, and package a Bun desktop app with one CLI: bunmaska init / dev / build, plus the engine-store commands to pin a WebKit version."
seoTitle: "The bunmaska CLI - init, dev, build, engine store"
order: 2
---

Installing the package gives you the `bunmaska` command - your **developer tool**. The whole development loop lives here: scaffold, run, package. It is not bundled into your app and your users never install it; what they get is a standalone executable (see [Shipping Your App](/docs/shipping)). Everything below is for you, not them.

## `bunmaska init [name]`

Scaffolds a runnable starter from an embedded template: a `main.ts`, a `preload.js`, a renderer (`index.html` + script), a `bunmaska.config.ts`, and a `package.json` wired to depend on `bunmaska`.

```sh
bunmaska init my-app
```

## `bunmaska dev`

Runs your app and reacts to file changes (debounced). This is what you'll have open all day, so it is built to not waste your time:

- **Main-process edits restart** the app; the restart waits for the old process to actually exit first, so you never get two windows or a lost single-instance lock.
- **Renderer asset edits live-reload** the open windows in place - no restart. With a [`renderer` block](/docs/building#bundling-your-renderer) in your config, edits under the renderer entry's directory **rebuild the bundle first**, then the new output triggers the reload; a broken edit prints the bundler error and keeps the loop alive.
- **Preload edits restart** (the preload is bundled and injected at window construction, so a reload would re-inject the stale script - restarting is the honest action).
- **No-op saves do nothing.** Changes are content-hashed, so a formatter rewriting identical bytes or a metadata-only touch doesn't restart anything. Atomic editor saves (write-temp-then-rename) are handled too.
- **Window position survives restarts.** The first window's bounds are saved to `.bunmaska-dev-state.json` (add it to `.gitignore`; the scaffold already does) and restored on the next start, instead of reopening at the OS default. Packaged apps never touch this.
- If the app has quit and you touch a renderer file, it says so ("app is not running") instead of pretending to reload a corpse.
- A project's [engine pin](/docs/concepts/engine) (`engine.webkit` in the config) is respected - `dev` and `run` launch on the pinned engine, same as `build`.

```sh
bunmaska dev
```

## `bunmaska run <entry>`

Runs an entry file once, no watching. Equivalent to `bun run <entry>` with Bunmaska's runtime wiring.

```sh
bunmaska run src/main.ts
```

## `bunmaska build`

Compiles your app with `bun build --compile`, bundles it next to the Bun runtime (which `dlopen`s system WebKit, so there's no Chromium to ship), and emits real distributables:

- **macOS** - a `.app` bundle (with a `.icns` converted from your PNG), optional code-signing/notarization, and a `.dmg`.
- **Linux** - an AppDir `.tar.gz` and a `.deb`.

```sh
bunmaska build
```

The entry defaults to the `entry` in your `bunmaska.config.ts` (the `init` scaffold sets it); pass it explicitly (`bunmaska build src/main.ts`) to override.

## `bunmaska build --update`

Everything `build` does, plus it emits the auto-update feed the runtime `autoUpdater` consumes: an `update.json` manifest, a content-hashed `.tar.zst`, and - with `--update-key` - a detached Ed25519 `.sig` beside the artifact. Because there's no 150 MB engine to re-download, updates are tiny.

```sh
bunmaska build --update --update-key update-signing-key.pem --channel stable
```

Without `--update-key` the build prints a loud warning and the feed is **unsigned - the runtime autoUpdater refuses unsigned updates**, so sign anything you intend to ship. The full flow (keygen, hosting, wiring `setFeedURL`) is in [Building & Distribution](/docs/building#auto-updates).

## `bunmaska keygen`

Generates the Ed25519 update-signing key pair: `update-signing-key.pem` (private - passes to `build --update-key`, never ships in your app) and `update-public-key.pem` (baked into your app via `autoUpdater.setFeedURL({ url, publicKey })`). Refuses to overwrite existing key files; `--out <dir>` picks the destination.

```sh
bunmaska keygen
```

## `bunmaska engine <subcommand>`

Manages the pinned-WebKit engine store - the opt-in "tested == shipped" tier. See [Pinned WebKit Engine](/docs/concepts/engine) for the full story; the subcommands:

```sh
bunmaska engine list             # installed engines (side by side) + refcounts
bunmaska engine available        # engines published on the feed (marks installed + this-machine)
bunmaska engine which [dir]      # the engine a project resolves
bunmaska engine install <path>   # install a local engine directory
bunmaska engine install <url>    # install a published .tar.zst - signature + hash verified
bunmaska engine use <id>         # print the per-project config to add (there is no --global)
bunmaska engine prune            # garbage-collect engines no installed app references
bunmaska engine verify <id>      # structural integrity check on an installed engine
```

Most apps never touch this - the system WebKit default is the right answer for them. It's here for when you genuinely need the exact build you tested.

## `bunmaska doctor [dir]`

A quick health report: the Bun version, the platform, the engine store, and the engine the current project resolves (and whether it's installed). Run it when something engine-related looks off.

```sh
bunmaska doctor
```

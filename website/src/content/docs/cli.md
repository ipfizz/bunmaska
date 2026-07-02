---
title: The CLI
description: One command - bunmaska - that scaffolds, runs, watches, packages, and auto-updates your app. Pure Bun, no Xcode project, no electron-builder.
order: 2
---

Installing the package gives you the `bunmaska` command - your **developer tool**. The whole development loop lives here: scaffold, run, package. It is not bundled into your app and your users never install it; what they get is a standalone executable (see [Shipping Your App](/docs/shipping)). Everything below is for you, not them.

## `bunmaska init [name]`

Scaffolds a runnable starter from an embedded template: a `main.ts`, a `preload.js`, a renderer (`index.html` + script), a `bunmaska.config.ts`, and a `package.json` wired to depend on `bunmaska`.

```sh
bunmaska init my-app
```

## `bunmaska dev`

Runs your app and restarts it on file changes (debounced). This is what you'll have open all day.

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

Everything `build` does, plus it emits the auto-update feed (`update.json` + a content-hashed `.tar.zst`) that the runtime `autoUpdater` consumes. Because there's no 150 MB engine to re-download, updates are tiny.

```sh
bunmaska build --update --channel stable
```

> `quitAndInstall`'s final atomic swap-and-relaunch is still experimental. The check → download → verify → stage engine is solid; the very last step is the alpha part.

## `bunmaska engine <subcommand>`

Manages the pinned-WebKit engine store - the opt-in "tested == shipped" tier. See [Pinned WebKit Engine](/docs/concepts/engine) for the full story; the subcommands:

```sh
bunmaska engine list             # installed engines (side by side) + refcounts
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

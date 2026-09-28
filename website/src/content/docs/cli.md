---
title: The CLI
description: "Scaffold, run, and package a Bun desktop app with one CLI: bunmaska init / dev / build, plus the engine-store commands to pin a WebKit version."
seoTitle: "The bunmaska CLI - init, dev, build, engine store"
order: 2
---

Installing the package gives you the `bunmaska` command - your **developer tool**. The whole development loop lives here: scaffold, run, package. It is not bundled into your app and your users never install it; what they get is a standalone executable (see [Shipping Your App](/docs/shipping)). Everything below is for you, not them. `bunmaska <command> --help` prints the usage for any of them. A command rejects flags and extra arguments it does not take, and a failure prints one line, not a stack trace.

## `bunmaska init [dir]`

Scaffolds a runnable starter from an embedded template: `src/main.ts`, `src/preload.js`, a renderer page (`src/index.html`), a `bunmaska.config.ts`, a `package.json` wired to depend on `bunmaska` (with `@types/bun` and a `build` script that writes into `dist/`), a `tsconfig.json` so it type-checks out of the box, plus a `.gitignore` and a `README.md`. The app is named after the directory unless you name it yourself. Like an Electron starter, it quits when its last window closes, except on macOS, where clicking the Dock icon reopens a window.

```sh
bunmaska init my-app        # creates ./my-app, named my-app
bunmaska init .             # scaffolds into the current directory, named after it
bunmaska init my-app .      # scaffolds into the current directory, named my-app
```

It refuses to overwrite: if any file it would write already exists, nothing is written.

## `bunmaska dev`

Runs your app and reacts to file changes (debounced). This is what you'll have open all day, so it is built to not waste your time:

- **Main-process edits restart** the app: your entry, any local module it imports (`.js` included, followed transitively), and any other TypeScript file outside the renderer entry's directory. The restart waits for the old process to actually exit first (force-killing one that ignores `SIGTERM` after a grace period), so you never get two windows or a lost single-instance lock.
- **Other edits live-reload** the open windows in place - no restart. With a [`renderer` block](/docs/building#bundling-your-renderer) in your config, edits under the renderer entry's directory and to its `renderer.copy` sources **rebuild the bundle first**, then the new output triggers the reload; a broken edit prints the bundler error and keeps the loop alive. Every restart rebuilds the renderer first, too, so a renderer edit that lands together with a main-process edit is never lost.
- **Preload edits restart** - a file named `preload.js` / `.mjs` / `.cjs` / `.ts`, including a copied one (the preload is bundled and injected at window construction, so a reload would re-inject the stale script - restarting is the honest action).
- **Config edits are not applied live.** Editing `bunmaska.config.ts` prints a reminder to restart `bunmaska dev`.
- **Some paths are never watched:** `node_modules`, dotfiles and dot directories, `.app` bundles, and the root-level `build/`, `out/` and `coverage/` directories. `dist/` is watched on purpose, since your renderer output lands there.
- **No-op saves do nothing.** Changes are content-hashed, so a formatter rewriting identical bytes or a metadata-only touch doesn't restart anything. Atomic editor saves (write-temp-then-rename) are handled too.
- **Window placement survives restarts.** The first window's bounds are saved to `.bunmaska-dev-state.json` (add it to `.gitignore`; the scaffold already does) and restored on the next start, instead of reopening at the OS default - size and position on macOS and Windows, size only on Linux, where the compositor owns position. Packaged apps never touch this.
- If the app has quit and you touch a renderer file, it says so ("app is not running") instead of pretending to reload a corpse.
- A project's [engine pin](/docs/concepts/engine) (`engine.webkit` in the config) is respected - `dev` and `run` launch on the pinned engine, same as `build`.

```sh
bunmaska dev
```

## `bunmaska run <entry> [args...]`

Runs an entry file once, no watching. Equivalent to `bun run <entry>` with Bunmaska's runtime wiring; trailing arguments are forwarded to the app (`--help` included), and so are Ctrl+C and `SIGTERM`, so the app gets its chance to quit cleanly.

```sh
bunmaska run src/main.ts --verbose
```

## `bunmaska build`

Compiles your app with `bun build --compile`, bundles it next to the Bun runtime (which `dlopen`s system WebKit, so there's no Chromium to ship), and emits real distributables:

- **macOS** - a `.app` bundle (with a `.icns` converted from your PNG), optional code-signing/notarization, and a `.dmg`.
- **Linux** - an AppDir `.tar.gz` and a `.deb`.
- **Windows** (`--target windows`) - a portable `<Name>/` directory and a `.zip` (x64); `--embed-engine <dir>`, or `engine.embed: true` with an installed pin, bundles a WinCairo engine into it.

`--embed-engine`, `--sign`, `--notarize` and `--dmg` are rejected for targets they do not apply to, and `--notarize` without `--sign` is refused before anything is built.

```sh
bunmaska build
```

The entry defaults to the `entry` in your `bunmaska.config.ts` (the `init` scaffold sets it); pass it explicitly (`bunmaska build src/main.ts`) to override. `name`, `id` and `icon` are read from the same config when the flags are not given - flag beats config, config beats the fallback derived from the entry file name.

## `bunmaska build --update`

Everything `build` does, plus it emits the auto-update feed the runtime `autoUpdater` consumes: an `update.json` manifest, a content-hashed `.tar.zst`, and - with `--update-key` - a detached Ed25519 signature for each (`update.json.sig` and `<artifact>.sig`), four files in all. `--channel` defaults to the config's `updates.channel`, else `stable`. Because there's no 150 MB engine to re-download, updates are tiny.

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
bunmaska engine install <id>     # an engine-id, fetched from the feed
bunmaska engine install <path>   # install a local engine directory
bunmaska engine install <url>    # install a published .tar.zst - signature + hash verified
bunmaska engine use <id>         # print the per-project config to add (there is no --global)
bunmaska engine use <id> --for <dir>   # same, for a project in another directory
bunmaska engine prune            # garbage-collect engines no installed app references
bunmaska engine prune --dry-run  # preview what prune would remove
bunmaska engine prune --force    # prune even when no app has registered a dependency yet
bunmaska engine verify <id>      # structural integrity check on an installed engine
```

Most apps never touch this - the system WebKit default is the right answer for them. It's here for when you genuinely need the exact build you tested.

## `bunmaska doctor [dir]`

A quick health report: the Bun version, the platform, the engine store, and the engine the current project resolves (and whether it's installed). It exits 1 when the project pins a full engine id for this OS and architecture that is not installed (a pin built for another platform is reported as such and ignored here), and tells you to run `bun install` in the project when it has no `node_modules`. Run it when something engine-related looks off.

```sh
bunmaska doctor
```

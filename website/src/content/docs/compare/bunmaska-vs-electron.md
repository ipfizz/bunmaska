---
title: Bunmaska vs Electron
description: The head-to-head - same shape, a tenth of the weight - with the rows where Electron still wins left in, because we're allergic to lying.
order: 1
---

The short version: on maturity, ecosystem, and depth-of-Windows, Electron wins - it's a decade-old incumbent running half your desktop. On size, supply-chain footprint, and native-module DX, Bunmaska wins by a structural margin Electron can't close without un-bundling Chromium. Bunmaska now runs on all three desktop OSes (Windows is x64-first, with a few engine-blocked APIs), so "no Windows" is no longer the simple dividing line it used to be.

## The table

| | Electron | Bunmaska |
| --- | --- | --- |
| Download size | 150 MB+ | **~16-23 MB** |
| Installed size | ~220 MB | **~60 MB** |
| Rendering engine | bundled Chromium (every app, again) | **system WebKit** by default, pinnable via the engine store (from-source WinCairo on Windows) |
| Runtime | Node + V8 | **Bun + JavaScriptCore** |
| Process model | multi-process (sandboxed renderers) | **single cooperatively-pumped process** |
| Native modules | node-gyp / N-API / electron-rebuild | **a `.ts` file that `dlopen`s the OS** |
| Compile step | yes | **none** |
| Runtime deps | several | **zero** |
| Platforms | Win / macOS / Linux | **Win (x64) / macOS / Linux** |
| API | the original | **drop-in, ~70-80% parity** |
| Maturity | 10+ years, runs everything | **alpha** |

## Where Electron still wins (yes, really)

- **Windows depth.** Bunmaska now runs on Windows (x64), but Electron is still ahead there: Windows-on-ARM64, no engine-blocked APIs (Bunmaska can't serve custom `protocol://` or do `printToPDF`/`capturePage` on WinCairo), and a runtime you don't have to build/bundle yourself. If you need Windows ARM64 or those specific APIs today, Electron wins.
- **The multi-process sandbox.** Electron isolates each renderer and survives a renderer crash. Bunmaska is one process - a WebKit/JSC crash takes the whole app with it. That's a real defense-in-depth trade, not a rounding error.
- **Ecosystem & maturity.** electron-builder, Forge, a decade of Stack Overflow answers, thousands of compatible native modules, and actual production track record. Bunmaska has none of that yet.
- **The long tail of the API.** That last ~20-30% - `BrowserView`, sync IPC, the Chromium-internal surface - is where you'll hit walls.

## Where Bunmaska wins

- **Size & updates.** ~3× smaller installed, ~7-10× smaller to download, tiny updates, and no Chromium-CVE re-ship treadmill.
- **Buildless native modules.** The `node-gyp` / `electron-rebuild` treadmill simply doesn't exist. See [Native Modules](/docs/native-modules/overview).
- **Supply chain.** Zero runtime deps, zero compiled native code, no postinstall scripts. Your SBOM is "Bun + your code."

## So which should you use?

If you need Windows ARM64, the full API surface, or battle-tested stability **today** - use Electron, and check back on Bunmaska later. If you're shipping a focused app for macOS, Linux, or Windows x64 and you care that it's small, fast, and doesn't drag a browser engine and a compiler toolchain along for the ride - that's exactly what Bunmaska is for.

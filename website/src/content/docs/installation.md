---
title: Installation
description: One package, no postinstall ritual, no compiler. You will need Bun - yes, that is the point.
order: 3
---

## Requirements

- **[Bun](https://bun.sh) ≥ 1.3.** Bunmaska runs on Bun, not Node. This is not negotiable; it's the foundation.
- **macOS, Linux, or Windows.** Each drives the OS's own WebKit - never Chromium.
  - macOS uses AppKit + `WKWebView` via `objc_msgSend`.
  - Linux uses GTK 4 + WebKitGTK 6 via `dlopen` (so `libgtk-4` / `libwebkitgtk-6.0` need to be present - they are on most modern desktops).
  - Windows (x64) uses Win32 + a WinCairo `WebKit2.dll` we build from source and bundle (there's no system WebKit on Windows). ARM64 is on the roadmap.

## Install

```sh
bun add bunmaska
# or, if you must:
npm i bunmaska
```

That's the whole install. No native build step runs. No `node-gyp`. No Python. If your terminal is suspiciously quiet, that's correct.

## The CLI comes with it

Installing the package gives you the `bunmaska` command - scaffold, dev, run, and package:

```sh
bunmaska init my-app     # scaffold a runnable starter
bunmaska dev             # run with file-watch + auto-restart
bunmaska build           # a .app (add --dmg for a disk image) or AppDir/.deb
```

Install it globally if you want the command everywhere:

```sh
bun add -g bunmaska
bunmaska --help
```

> Heads up: it's alpha, so pin your version (`bunmaska@0.1.x`) and expect the surface to move between releases. We'll tell you what changed.

Next: [Quickstart](/docs/quickstart).

---
title: Shipping Your App
description: What you hand a user is a standalone executable - a .app or a .deb they double-click. The bunmaska CLI is your dev tool; it never ships. Plus the honest story of how a pinned engine reaches their machine.
order: 3
---

The thing you give a user is **a standalone executable**, not a script and not a copy of the `bunmaska` CLI. `bunmaska build` compiles your app - Bun runtime and your JavaScript fused into one native binary (`bun build --compile`) - and wraps it as a `.app` on macOS, an AppDir + `.deb` on Linux, or a portable folder + `.zip` on Windows. They double-click it. That's the whole interaction.

## The CLI is for you, not them

`bunmaska` (init / dev / build / engine / doctor) is a **developer tool**. It is not bundled into your app and your users never install it. The runtime your app actually uses doesn't import the CLI at all - they're cleanly separated. So:

- **You** run `bunmaska build` to produce the executable.
- **Your user** runs the executable. No terminal, no `npm`, no `bunmaska`, no "first install Bun."

This is the normal native-app deal: you ship a binary, they run a binary.

## What "build" produces

```sh
bunmaska build                 # the host platform's distributable
bunmaska build --target linux  # cross-build a Linux AppDir + .deb from macOS
bunmaska build --sign … --dmg  # macOS: code-sign + a .dmg disk image
bunmaska build --update --update-key <pem>  # also emit the signed auto-update feed
                               # (update.json + .tar.zst, each with a .sig; key from `bunmaska keygen`)
```

- **macOS** - a `.app` bundle (icon converted from your PNG), optional code-signing/notarization, and an optional `.dmg`.
- **Linux** - an AppDir, a `.tar.gz`, and a `.deb` (which now declares its WebKitGTK + GTK dependencies, so a clean `apt install` pulls them in).
- **Windows** - a portable `<Name>/` folder and a `.zip`, with the WinCairo engine embedded (see below).

No Chromium is bundled anywhere - macOS and Linux render on the system WebKit, Windows on the WebKit you embed.

## How a pinned engine reaches a user's machine

If your app uses the **default** (the system WebKit, macOS and Linux), there is nothing to deliver - the executable just runs. This is the right answer for almost every app, and it's a clean standalone binary today. Windows has no system WebKit, so a Windows app always needs the first option below.

If your app **pins** a specific WebKit (the [tested == shipped](/docs/concepts/engine) tier), the engine has to get onto the user's machine somehow - and crucially, **the user never runs `bunmaska engine install` for that**. `engine install` is a developer command. Delivery to an end user is the app's own job, three ways:

1. **Embed it in the bundle** (`engine.embed: true` for your installed pin, or `--embed-engine <dir>`) - the engine rides inside the distributable. *Windows only today* (a Windows app needs it - there is no system WebKit). Linux embedding is not built: `engine.embed: true` on a Linux build is refused with a clear error, rather than silently dropping the `.deb`'s WebKitGTK dependency line (which would crash on a clean box).
2. **Fetch on first run** - the app's runtime downloads its pinned engine (signature-verified) into the store the first time it launches. *Designed; not built yet.*
3. **Fall back to the system WebKit** - *Linux only.* If the pinned engine isn't present, the app launches anyway on the system WebKit and says so on stderr, so a Linux app always starts. Windows has nothing to fall back to: without an embedded engine (or one in the store), the app refuses to start and says why.

So the honest state: shipping a clean standalone executable on the system WebKit works now, and so does a Windows app with its engine embedded. Pinned-engine **delivery** beyond that (Linux embedding, auto-fetch) is the in-progress piece - the runtime's responsibility, never the user's.

> Rule of thumb: `bunmaska engine …` is something *you* type. Your users never see it.

---
title: Shipping Your App
description: What you hand a user is a standalone executable - a .app or a .deb they double-click. The bunmaska CLI is your dev tool; it never ships. Plus the honest story of how a pinned engine reaches their machine.
order: 3
---

The thing you give a user is **a standalone executable**, not a script and not a copy of the `bunmaska` CLI. `bunmaska build` compiles your app - Bun runtime and your JavaScript fused into one native binary (`bun build --compile`) - and wraps it as a `.app` on macOS or an AppDir + `.deb` on Linux. They double-click it. That's the whole interaction.

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
bunmaska build --update        # also emit the auto-update feed (update.json + .tar.zst)
```

- **macOS** - a `.app` bundle (icon converted from your PNG), optional code-signing/notarization, and an optional `.dmg`.
- **Linux** - an AppDir, a `.tar.gz`, and a `.deb` (which now declares its WebKitGTK + GTK dependencies, so a clean `apt install` pulls them in).

No Chromium is bundled either way - the app renders on the system WebKit.

## How a pinned engine reaches a user's machine

If your app uses the **default** (the system WebKit), there is nothing to deliver - the executable just runs. This is the right answer for almost every app, and it's a clean standalone binary today.

If your app **pins** a specific WebKit (the [tested == shipped](/docs/concepts/engine) tier), the engine has to get onto the user's machine somehow - and crucially, **the user never runs `bunmaska engine install` for that**. `engine install` is a developer command. Delivery to an end user is the app's own job, three ways:

1. **Embed it in the bundle** (`--embed-engine`) - the engine rides inside the distributable; first launch unpacks it into the shared store, and later apps reuse it. Bigger first download, tiny everything after. *Designed; not built yet.*
2. **Fetch on first run** - the app's runtime downloads its pinned engine (signature-verified) into the store the first time it launches. *Designed; not built yet.*
3. **Fall back to the system WebKit** - if the pinned engine isn't present, the app launches anyway on the system WebKit and says so on stderr. *This is today's behavior, and it means the app always starts.*

So the honest state: shipping a clean standalone executable on the system WebKit works now. The pinned-engine **delivery** (embed / auto-fetch) is the in-progress piece - the runtime's responsibility, never the user's.

> Rule of thumb: `bunmaska engine …` is something *you* type. Your users never see it.

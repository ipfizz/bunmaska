---
title: Quickstart
description: From zero to a real native window in about ninety seconds. The other steps are optional, and so is your patience.
order: 4
---

## Scaffold a project

```sh
bunmaska init my-app
cd my-app
bun install
```

This writes a runnable starter: a main process, a preload, a renderer, and a `bunmaska.config.ts`.

## Run it

```sh
bunmaska dev
```

A real native window opens, rendered by the system WebKit. No 150 MB of Chromium in sight. Edit a file and it reloads.

## The smallest real app

If you'd rather start from nothing, this is the whole thing:

```ts
// src/main.ts
import { app, BrowserWindow } from "bunmaska";

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 960, height: 720, title: "Hello Bunmaska" });
  win.loadURL("https://example.com");
});
```

Run it with `bun run src/main.ts` (or `bunmaska run src/main.ts`). A window appears. We are as surprised as you are.

## Wire up IPC

The Electron pattern you already know works unchanged:

```ts
// main process
import { ipcMain } from "bunmaska";
ipcMain.handle("add", (_event, a, b) => a + b);
```

```ts
// preload.js (isolated world, bundled before injection - imports work)
contextBridge.exposeInMainWorld("api", {
  add: (a, b) => __bunmaska.invoke("add", a, b),
});
```

Now `window.api.add(20, 22)` resolves to `42`, round-tripped through real WebKit in a dedicated isolated world - the way `contextIsolation: true` works in Electron. More in [IPC & Context Bridge](/docs/concepts/ipc).

## Ship it

```sh
bunmaska build          # .app on macOS (--dmg for a disk image), AppDir + .deb on Linux
bunmaska build --update # also emit the auto-update feed
```

That's the loop: `init → dev → build`. Tell your laptop fan it can sit this one out.

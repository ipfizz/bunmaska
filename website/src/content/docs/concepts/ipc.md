---
title: IPC & Context Bridge
description: "The main/renderer bridge in bunmaska: ipcMain, ipcRenderer, the context bridge, and preload - Electron-shaped IPC with context isolation on system WebKit."
seoTitle: "IPC and context isolation in bunmaska"
order: 1
---

bunmaska's IPC mirrors Electron's. The main process exposes handlers; a preload script bridges a safe surface to the page; the page calls it. No remote module, no `nodeIntegration` foot-gun - context isolation is on, in a dedicated isolated world.

## Main process: handle requests

```ts
import { ipcMain } from "bunmaska";

ipcMain.handle("dialog:open", async () => {
  // ...do privileged work...
  return "/Users/you/Documents/report.pdf";
});

ipcMain.handle("add", (_event, a: number, b: number) => a + b);
```

## Preload: expose a safe surface

The preload runs in an **isolated world** and is **bundled before injection**, so you can `import` modules - just keep it browser code (no Node APIs). Two globals are available to it: `contextBridge` and `__bunmaska`.

```js
// preload.js
contextBridge.exposeInMainWorld("api", {
  add: (a, b) => __bunmaska.invoke("add", a, b),
  openDialog: () => __bunmaska.invoke("dialog:open"),
});
```

## Renderer: call it

```js
const sum = await window.api.add(20, 22); // 42
const path = await window.api.openDialog();
```

The page can reach `window.api`, but it **cannot** reach the bridge internals, Bun, or the main process directly - exactly like Electron's `contextIsolation: true`.

## Why a context bridge at all?

Because your renderer loads web content, and web content should not have a direct line to the operating system. The bridge is the airlock: you decide precisely which functions cross it, and everything else stays sealed off in the main process.

> The bridge is async-only by design - values are structured-cloned across the world boundary, just like Electron's `contextBridge`. If you're porting code that used synchronous `ipcRenderer.sendSync`, you'll move it to `invoke`.

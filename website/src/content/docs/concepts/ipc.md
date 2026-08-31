---
title: IPC & Context Bridge
description: "The main/renderer bridge in bunmaska: ipcMain, ipcRenderer, the context bridge, and preload - Electron-shaped IPC with context isolation on system WebKit."
seoTitle: "IPC and context isolation in bunmaska"
order: 1
---

Bunmaska's IPC mirrors Electron's. The main process exposes handlers; a preload script bridges a safe surface to the page; the page calls it. No remote module, no `nodeIntegration` foot-gun - context isolation is on, in a dedicated isolated world on macOS and Linux (Windows caveats below).

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

The page can reach `window.api`, but it cannot reach the bridge internals, Bun, or the main process directly. The *shape* is Electron's `contextIsolation: true`; the *guarantee* is weaker, and we'd rather you know exactly how:

- On **macOS and Linux** the preload really does run in a separate JS world (`WKContentWorld` / a WebKitGTK named world), so the page cannot see preload globals. But the transport between the worlds is a shared-DOM `CustomEvent` channel, not Electron's V8-level boundary - a hostile page can observe those events and forge requests to the API you exposed. Treat the bridge as a way to keep your API surface small and deliberate, not as a wall a malicious page cannot see through.
- On **Windows** (WinCairo) there is no isolated-world API at all yet, so the preload runs in the **page world** - the page shares a global scope with it. Don't rely on world isolation as a security boundary there.

Practical consequences of the DOM-channel design, on every platform:

- **Async-only.** Every exposed function returns a `Promise` on the page side, even if the real handler is synchronous. Porting `ipcRenderer.sendSync`? It becomes `invoke`.
- **Data only.** Arguments and return values are structured-clone copied - no functions as arguments, no callbacks, no live object references.
- **Snapshot semantics for values.** Non-function properties are deep-cloned and frozen into the page once, at expose time; later mutations on the preload side are not reflected.

## Why a context bridge at all?

Because your renderer loads web content, and web content should not have a direct line to the operating system. The bridge is the airlock: you decide precisely which functions cross it, and everything else stays sealed off in the main process. That holds regardless of the isolation caveats above - the page can only ever call what you chose to expose.

---
title: Frameless Windows & Custom Title Bars
description: Drop the OS title bar and draw your own - a draggable region and window controls, the Electron way, with one cross-platform CSS convention.
order: 4
---

Want your own title bar instead of the OS one? Open a **frameless** window and draw the bar in HTML. Bunmaska gives you a draggable region and built-in window controls without any per-app IPC wiring.

## A frameless window

```ts
import { app, BrowserWindow } from 'bunmaska';

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 320,
    height: 480,
    frame: false, // <- no OS title bar; you draw your own
    webPreferences: { preload: '...' },
  });
  win.loadFile('index.html');
});
```

`frame: false` removes the native title bar and borders, giving you the full client area to render into.

## Make a region draggable: `--app-region`

Electron uses the `-webkit-app-region: drag` CSS property to mark a draggable region. Most of the system WebKits Bunmaska drives **don't parse** that Chromium-flavoured property, so Bunmaska standardises on a CSS **custom property** instead:

```css
.titlebar        { --app-region: drag; }     /* drag the window from here   */
.titlebar button { --app-region: no-drag; }  /* ...but not from the buttons */
```

Custom properties inherit, so set `--app-region: drag` on the bar and `--app-region: no-drag` on the controls inside it - exactly the cascade you'd get from Electron's app-region. A left-button press anywhere in a `drag` region starts a native window move (edge-snap, shake-to-minimise and all).

> Under the hood Bunmaska also mirrors `--app-region` onto the native `-webkit-app-region`, so on macOS - where WKWebView honours it directly - dragging is fully native.

## Window controls

A built-in API is injected into every page - no `ipcMain` handler to write:

```js
window.__bunmaska.window.minimize();
window.__bunmaska.window.toggleMaximize(); // or maximize() / unmaximize()
window.__bunmaska.window.close();
window.__bunmaska.window.startDrag();      // manual drag, if you don't use --app-region
```

A minimal custom title bar:

```html
<div class="titlebar">
  <span class="title">My App</span>
  <button onclick="__bunmaska.window.minimize()">-</button>
  <button onclick="__bunmaska.window.toggleMaximize()">▢</button>
  <button onclick="__bunmaska.window.close()">✕</button>
</div>
<style>
  .titlebar { --app-region: drag; display: flex; align-items: center; height: 36px; }
  .titlebar button { --app-region: no-drag; }
</style>
```

## Platform support

We don't lie in tables - this one is still filling in:

| | Frameless (`frame: false`) | Drag (`--app-region`) | `window.__bunmaska.window` controls |
| --- | :---: | :---: | :---: |
| **Windows** | ✅ | ✅ | ✅ |
| **macOS** | ✅ | ✅ (native `-webkit-app-region`) | ◐ coming |
| **Linux** | ✅ | ◐ coming | ◐ coming |

The `--app-region` CSS convention and the `window.__bunmaska.window` API are stable; the macOS/Linux control handlers and Linux drag are wired next. Track them on the [roadmap](/roadmap), and check the [parity matrix](/docs/migrating/parity) for the rest.

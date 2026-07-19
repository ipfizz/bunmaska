---
title: "webFrame"
description: "Renderer-process API for zooming, injecting CSS, and evaluating script in the current bunmaska page - a partial drop-in for Electron's webFrame."
order: 24
---

Customize the rendering of the current web page from the renderer process. bunmaska's `webFrame` is a renderer-side object that runs inside the page's isolated world (which shares the DOM with the page), so its zoom and CSS mutations affect what you see. It covers the day-to-day subset of Electron's `WebFrame`: zoom, CSS injection, and script evaluation - but it does not yet model the frame-hierarchy tree (`top`/`parent`/`firstChild`), spellcheck, or resource accounting.

Process: Renderer

```ts
import { webFrame } from 'bunmaska/renderer';

// Zoom the current page to 200%.
webFrame.setZoomFactor(2);
```

> Note on zoom backing: this renderer-local `webFrame` implements zoom via WebKit's non-standard CSS `zoom` on the document element - a layout-zoom approximation, not the native WKWebView magnification (macOS) or WebKitGTK `zoom_level` (Linux). bunmaska's main process does expose a native page zoom on the window/`webContents` side, but the renderer `webFrame` here is deliberately renderer-local and does not call into it.

## Methods

### `webFrame.setZoomFactor(factor)`

`setZoomFactor(factor: number): void`

Changes the zoom factor to the specified factor. Zoom factor is zoom percent divided by 100, so 300% = `3.0`. The factor must be greater than `0.0`; non-finite or `<= 0` values are ignored (matching Electron's "must be greater than 0.0" rule, just without throwing).

```ts
import { webFrame } from 'bunmaska/renderer';

webFrame.setZoomFactor(1.5); // 150%
```

### `webFrame.getZoomFactor()`

`getZoomFactor(): number`

Returns the current zoom factor. If no zoom has been applied (or the underlying value is invalid), it returns `1`.

```ts
import { webFrame } from 'bunmaska/renderer';

webFrame.setZoomFactor(2);
console.log(webFrame.getZoomFactor()); // 2
```

### `webFrame.setZoomLevel(level)`

`setZoomLevel(level: number): void`

Changes the zoom level to the specified level. The original size is `0`, and each increment above or below multiplies the zoom factor by `1.2` (so level `1` ≈ 120%, level `-1` ≈ 83%). Implemented in terms of `setZoomFactor(1.2 ** level)`.

```ts
import { webFrame } from 'bunmaska/renderer';

webFrame.setZoomLevel(1); // ≈ 120%
```

> Unlike Chromium/Electron, bunmaska does not enforce the ±300%/50% clamp or the same-origin zoom-propagation policy. The level is a pure mathematical inverse of the factor and is applied to this frame only.

### `webFrame.getZoomLevel()`

`getZoomLevel(): number`

Returns the current zoom level, derived from the current factor (`log(factor) / log(1.2)`). With no zoom applied this is `0`.

```ts
import { webFrame } from 'bunmaska/renderer';

webFrame.setZoomFactor(1.2);
console.log(Math.round(webFrame.getZoomLevel())); // 1
```

### `webFrame.insertCSS(css)`

`insertCSS(css: string): string`

Injects CSS into the current web page by appending a `<style>` element (to `<head>` if present, otherwise the document element) and returns a unique key. Use that key with `removeInsertedCSS` to remove the stylesheet later.

```ts
import { webFrame } from 'bunmaska/renderer';

const key = webFrame.insertCSS('body { background: rebeccapurple; }');
// ...later
webFrame.removeInsertedCSS(key);
```

> Note: Electron's `insertCSS(css, options)` accepts a `cssOrigin: 'user' | 'author'` option. bunmaska's signature takes the CSS string only - every insertion behaves like an author-origin stylesheet.

### `webFrame.removeInsertedCSS(key)`

`removeInsertedCSS(key: string): void`

Removes a previously inserted stylesheet, identified by the key returned from `insertCSS`. An unknown or already-removed key is a no-op.

```ts
import { webFrame } from 'bunmaska/renderer';

const key = webFrame.insertCSS('a { color: hotpink; }');
webFrame.removeInsertedCSS(key); // safe to call once
webFrame.removeInsertedCSS(key); // calling again does nothing
```

### `webFrame.executeJavaScript(code)`

`executeJavaScript(code: string): Promise<unknown>`

Evaluates `code` in the current renderer world (the caller's world, matching Electron) via indirect global `eval`, and returns a `Promise` that resolves with the result or rejects if evaluation throws.

```ts
import { webFrame } from 'bunmaska/renderer';

const title = await webFrame.executeJavaScript('document.title');
console.log(title);
```

> Differences from Electron: this is the renderer-side evaluator, not the main-side `webContents.executeJavaScript`. It does not accept Electron's `userGesture` argument or a legacy `callback` parameter - it is Promise-only. There is no `executeJavaScriptInIsolatedWorld`.

## Properties

This `webFrame` exposes no instance properties. The frame-hierarchy and identity properties from Electron (`top`, `opener`, `parent`, `firstChild`, `nextSibling`, `routingId`, `frameToken`) are not modeled - see below.

## Not in bunmaska (yet)

The following Electron `webFrame` members are intentionally absent from this module:

- **`setVisualZoomLevelLimits(min, max)`** - no pinch-to-zoom limit control; zoom here is CSS layout-zoom only.
- **`setSpellCheckProvider`, `isWordMisspelled`, `getWordSuggestions`** - no spellchecker integration.
- **`insertText(text)`** - no programmatic insertion into the focused element.
- **`executeJavaScriptInIsolatedWorld` / `setIsolatedWorldInfo`** - script runs in the current world only; there is no separate isolated-world evaluator or world configuration.
- **`getResourceUsage()` / `clearCache()`** - no access to Blink-style memory caches (there is no Blink here; rendering is WebKit).
- **Frame-tree navigation: `getFrameForSelector`, `findFrameByName`, `findFrameByToken`, `findFrameByRoutingId`** - no API for resolving sub-frames.
- **Properties `top`, `opener`, `parent`, `firstChild`, `nextSibling`, `routingId`, `frameToken`** - the frame hierarchy is not exposed; `webFrame` represents the current frame only, with no links to relatives.
- **`insertCSS` `cssOrigin` option**, **`executeJavaScript` `userGesture`/`callback` arguments** - the implemented methods exist but with the trimmed signatures noted above.

Native-backed page zoom (WKWebView magnification on macOS / WebKitGTK `zoom_level` on Linux) does exist in bunmaska's main process, but this renderer `webFrame` does not route through it; a native-backed renderer zoom is a possible future enhancement.

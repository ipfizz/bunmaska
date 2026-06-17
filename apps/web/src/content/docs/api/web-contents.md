---
title: "webContents"
description: "Render and control the web page inside a BrowserWindow - Bunmaska's drop-in WebContents on system WebKit (macOS + Linux)."
order: 3
---

`webContents` controls and observes the page rendered inside a [`BrowserWindow`](browser-window.md). You don't construct it directly - you reach it through `win.webContents`, and most content methods on `BrowserWindow` delegate straight to it. It extends Node's `EventEmitter`, and on construction it bridges the native web view to `ipcMain`, so `ipcMain.handle` / `ipcRenderer.invoke` and `webContents.send` / `ipcRenderer.on` work with no per-window wiring.

A heads-up on scope: Bunmaska has exactly one frame per view. There is no Chromium underneath, so anything that depends on the multi-frame / multi-process model (subframes, `mainFrame`, `RenderProcessGone`, the debugger / CDP, input synthesis) simply isn't here. What follows is what the class actually exposes.

## Methods

### `contents.loadURL(url)`

* `url` string

Navigates to `url`. Returns `void` (Electron's promise-returning form is not implemented).

```ts
import { BrowserWindow } from 'bunmaska';

const win = new BrowserWindow({ width: 800, height: 600 });
win.webContents.loadURL('https://example.com');
```

### `contents.loadFile(filePath)`

* `filePath` string

Loads a local file. Relative paths are resolved against the current working directory and turned into a `file://` URL.

```ts
win.webContents.loadFile('renderer/index.html');
```

### `contents.getURL()`

Returns `string` - the current page URL, or `''` before the first navigation.

```ts
console.log(win.webContents.getURL());
```

### `contents.getTitle()`

Returns `string` - the page's current title, or `''`.

```ts
console.log(win.webContents.getTitle());
```

### `contents.isLoading()`

Returns `boolean` - whether a navigation is currently in progress. Tracked off the native navigation callbacks (`did-start-loading` sets it true; `did-stop-loading` / `did-finish-load` / `did-fail-load` clear it).

```ts
if (win.webContents.isLoading()) {
  console.log('still spinning');
}
```

### `contents.reload()`

Reloads the current page.

```ts
win.webContents.reload();
```

### `contents.reloadIgnoringCache()`

Reloads the current page, bypassing the cache. Wired on both backends.

```ts
win.webContents.reloadIgnoringCache();
```

### `contents.stop()`

Stops any in-progress load.

```ts
win.webContents.stop();
```

### `contents.goBack()`

Navigates back one entry in the session history, if possible.

```ts
if (win.webContents.canGoBack()) {
  win.webContents.goBack();
}
```

### `contents.goForward()`

Navigates forward one entry in the session history, if possible.

```ts
if (win.webContents.canGoForward()) {
  win.webContents.goForward();
}
```

### `contents.canGoBack()`

Returns `boolean` - whether there is a previous history entry to go back to.

### `contents.canGoForward()`

Returns `boolean` - whether there is a next history entry to go forward to.

### `contents.executeJavaScript(code)`

* `code` string

Returns `Promise<unknown>` - evaluates `code` in the page and resolves to the script's completion value, matching Electron's semantics: a bare expression resolves to its value, a returned `Promise` resolves to its fulfilled value, and a thrown error rejects. Only JSON-serializable results survive the trip (think `JSON.stringify`). There is no `userGesture` argument.

```ts
const title = await win.webContents.executeJavaScript('document.title');
const ua = await win.webContents.executeJavaScript('navigator.userAgent');
console.log(title, ua);
```

### `contents.insertCSS(css)`

* `css` string

Returns `Promise<string>` - injects a `<style>` block into the page and resolves to a key you can later pass to [`removeInsertedCSS`](#contentsremoveinsertedcsskey). Implemented purely through the page-world exec channel (no native CSS call), so it behaves the same on both backends. Note: there is no `options` argument.

```ts
const key = await win.webContents.insertCSS('body { background: #111; color: #eee; }');
```

### `contents.removeInsertedCSS(key)`

* `key` string

Returns `Promise<void>` - removes a stylesheet previously added with `insertCSS`.

```ts
await win.webContents.removeInsertedCSS(key);
```

### `contents.printToPDF()`

Returns `Promise<Buffer>` - renders the current page to a PDF and resolves to its bytes. _macOS only._ On Linux it rejects with an `UnsupportedPlatformError` (WebKitGTK has no page-to-PDF-bytes API). Takes no options object (no page size, margins, etc. yet).

```ts
import { writeFile } from 'node:fs/promises';

const pdf = await win.webContents.printToPDF(); // macOS only
await writeFile('out.pdf', pdf);
```

### `contents.capturePage()`

Returns `Promise<NativeImage>` - captures the page to a [`NativeImage`](native-image.md). _macOS only._ Rejects on Linux. No `rect` / `opts` arguments.

```ts
const image = await win.webContents.capturePage(); // macOS only
await writeFile('shot.png', image.toPNG());
```

### `contents.setZoomFactor(factor)`

* `factor` number - `1` = 100%.

Sets the page zoom factor natively.

```ts
win.webContents.setZoomFactor(1.25);
```

### `contents.getZoomFactor()`

Returns `number` - the current zoom factor (last value set; defaults to `1`).

### `contents.setZoomLevel(level)`

* `level` number - `0` = 100%.

Sets zoom by level, where `factor = 1.2 ** level` (Electron's relation).

```ts
win.webContents.setZoomLevel(1); // ~120%
```

### `contents.getZoomLevel()`

Returns `number` - the current zoom level (the inverse of `setZoomLevel`).

### `contents.setUserAgent(userAgent)`

* `userAgent` string

Overrides the User-Agent string for subsequent navigations on this view. (No `userAgentMetadata` argument.)

```ts
win.webContents.setUserAgent('Bunmaska/1.0');
```

### `contents.getUserAgent()`

Returns `string` - the User-Agent override set via `setUserAgent`, or `''` if none (in which case the platform default is used).

### `contents.setWindowOpenHandler(handler)`

* `handler` Function - receives `{ url }` and returns `{ action: 'allow' | 'deny' }`.

Sets the handler consulted when the page requests a new window (`window.open` / `target=_blank`). Honest caveat: the native popup is **always blocked** in v1 - child-window creation isn't supported. Returning `{ action: 'allow' }` logs a warning and still blocks the window, so the practical pattern is to open the URL externally and return `deny`. The handler's return shape is `{ action }` only - no `overrideBrowserWindowOptions`, and there is no `did-create-window` event.

```ts
import { shell } from 'bunmaska';

win.webContents.setWindowOpenHandler(({ url }) => {
  void shell.openExternal(url);
  return { action: 'deny' };
});
```

### `contents.openDevTools()`

Opens the developer tools (web inspector) for this view. Best-effort: on macOS it relies on a private inspector SPI and logs a warning if unavailable; on Linux it uses the WebKitGTK inspector. No `options` argument (no docking mode).

```ts
win.webContents.openDevTools();
```

### `contents.closeDevTools()`

Closes the developer tools. Best-effort.

### `contents.toggleDevTools()`

Opens the devtools if closed, closes them if open (tracked via Bunmaska's own open/closed flag).

```ts
win.webContents.toggleDevTools();
```

### `contents.isDevToolsOpened()`

Returns `boolean` - whether the devtools were last opened by Bunmaska and not since closed. This is Bunmaska's own bookkeeping flag, not a query of the live inspector window.

### `contents.isDestroyed()`

Returns `boolean` - whether the owning window has been closed/destroyed.

```ts
if (!win.webContents.isDestroyed()) {
  win.webContents.send('tick', Date.now());
}
```

### `contents.send(channel, ...args)`

* `channel` string
* `...args` any[]

Sends an event on `channel` to the renderer, where `ipcRenderer.on(channel, ...)` receives it. Arguments are structured-clone serialized through the IPC envelope.

```ts
win.webContents.send('update-available', { version: '1.2.0' });
```

```ts
// renderer
import { ipcRenderer } from 'bunmaska/renderer';

ipcRenderer.on('update-available', (_event, info) => {
  console.log('new version', info.version);
});
```

## Events

`webContents` extends `EventEmitter`. Bunmaska emits a deliberately small, navigation-focused subset, driven by the native navigation delegate (macOS) / WebKitGTK load signals (Linux).

### Event: 'did-start-loading'

Emitted when a load begins (the tab spinner starts).

```ts
win.webContents.on('did-start-loading', () => {
  console.log('loading…');
});
```

### Event: 'did-stop-loading'

Emitted when the load stops (the spinner stops).

### Event: 'dom-ready'

Emitted when the document in the page is ready.

```ts
win.webContents.on('dom-ready', () => {
  void win.webContents.insertCSS('html { scroll-behavior: smooth; }');
});
```

### Event: 'did-finish-load'

Emitted when navigation is done and the page has loaded successfully.

```ts
win.webContents.on('did-finish-load', () => {
  console.log('loaded', win.webContents.getURL());
});
```

### Event: 'did-navigate'

Returns:

* `event` Event - an empty object (placeholder; no `preventDefault`).
* `url` string - the URL navigated to.

Emitted when a main-frame navigation completes. Note the leaner payload than Electron: no `httpResponseCode` / `httpStatusText`.

```ts
win.webContents.on('did-navigate', (_event, url) => {
  console.log('navigated to', url);
});
```

### Event: 'did-fail-load'

Returns:

* `event` Event - an empty object placeholder.
* `errorCode` number
* `errorDescription` string
* `validatedURL` string - the current URL at the time of failure.

Emitted when a load fails. On Linux the error code/description may be coarse (`-1` / `''`) because WebKitGTK surfaces less detail.

```ts
win.webContents.on('did-fail-load', (_event, code, description, url) => {
  console.error(`load failed (${code}): ${description} @ ${url}`);
});
```

## Properties

### `contents.id`

A `number` - process-unique id, matching Electron's `webContents.id`. Read-only.

```ts
console.log(win.webContents.id);
```

## Not in Bunmaska (yet)

Electron's `webContents` is huge; Bunmaska implements the navigation + scripting + IPC core and leaves the rest out. Notable gaps:

- **Module-level statics** - `webContents.getAllWebContents()`, `getFocusedWebContents()`, `fromId()`, `fromFrame()`, `fromDevToolsTargetId()`. The class is only reachable via `win.webContents`; there's no registry lookup.
- **The frame model** - `mainFrame`, `opener`, `frames`, and every multi-frame event (`will-frame-navigate`, `did-frame-navigate`, `did-frame-finish-load`, `did-start-navigation`, `did-navigate-in-page`). One view, one frame, no `WebFrameMain`.
- **Cancellable navigation** - there is no `will-navigate` / `will-redirect`, and the `event` objects passed to the events that do fire have no `preventDefault()`.
- **Process / lifecycle events** - `render-process-gone`, `unresponsive` / `responsive`, `crashed`, `destroyed`, `will-prevent-unload`. There's no separate renderer process to go gone.
- **DevTools protocol** - no `debugger` (CDP), no `inspectElement`, no `setDevToolsWebContents`. DevTools is open/close/toggle only.
- **Input & focus** - no `sendInputEvent`, `before-input-event` / `input-event`, `focus()` / `isFocused()`, `beginFrameSubscription`, `startDrag`.
- **Printing & content** - `print()` (only `printToPDF`, macOS-only), `savePage`, `getPrintersAsync`, `findInPage` / `stopFindInPage`.
- **Editing & clipboard commands** - `undo`/`redo`/`cut`/`copy`/`paste`/`selectAll`/`replace`, `cut`-style menu wiring, `replaceMisspelling`.
- **Media / audio** - `isAudioMuted` / `setAudioMuted`, `setBackgroundThrottling`, `getOSProcessId`, `getProcessId`.
- **`setWindowOpenHandler` with `allow`** - child-window creation is unsupported, so `{ action: 'allow' }` is logged and ignored; there is no `did-create-window`, and the handler return type omits `overrideBrowserWindowOptions`.
- **`capturePage` / `printToPDF` on Linux** - present in the API but reject with `UnsupportedPlatformError`; both are _macOS only_ for now.
- **Session / zoom plumbing** - no `session` property, no `setVisualZoomLevelLimits`, no `zoomLevel` persistence across reloads (zoom is stored in-memory and reapplied per `setZoomFactor`).

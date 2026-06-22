---
title: "BrowserWindow"
description: "Create and control top-level application windows in the Bunmaska main process - the drop-in equivalent of Electron's BrowserWindow."
order: 2
---

Create and control top-level application windows. `BrowserWindow` is Bunmaska's drop-in equivalent of Electron's class of the same name: it extends Node's `EventEmitter`, owns a `WebContents` for all page-related operations, and is backed by `NSWindow` on macOS, a GTK4 `GtkWindow` on Linux, and a Win32 `HWND` on Windows.

Like Electron, you cannot use this module until the `app` `ready` event has fired.

```ts
// In the main process.
import { app, BrowserWindow } from 'bunmaska';

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 800, height: 600 });
  win.loadURL('https://github.com');
  // Or a local file:
  // win.loadFile('index.html');
});
```

## Constructor

### `new BrowserWindow([options])`

Creates a new window. All options are optional; unspecified options fall back to Bunmaska's defaults (`800x600`, title `"Bunmaska"`, shown immediately, resizable).

The supported `options` are a deliberately small subset of Electron's `BrowserWindowConstructorOptions`:

- `width` number - content width in pixels. Default `800`.
- `height` number - content height in pixels. Default `600`.
- `title` string - initial window title. Default `"Bunmaska"`.
- `show` boolean - show the window immediately on creation. Default `true`.
- `resizable` boolean - whether the user can resize the window. Default `true`.
- `frame` boolean - draw the OS frame/title bar. `false` opens a frameless window.
- `fullscreen` boolean - open in fullscreen. Default `false`.
- `webPreferences` object - per-window renderer preferences. The only supported key is `preload`: an absolute-resolved path to a script run in an isolated world (Electron's `contextIsolation: true`) before the page's own scripts. It is read synchronously at construction; an unreadable path throws.

```ts
import { BrowserWindow } from 'bunmaska';
import { join } from 'node:path';

const win = new BrowserWindow({
  width: 1024,
  height: 768,
  title: 'My App',
  frame: false,
  webPreferences: {
    preload: join(import.meta.dir, 'preload.ts'),
  },
});
```

There is no `BrowserWindowConstructorOptions` mega-bag here - if an option isn't in the list above, it isn't wired yet. See [Not in Bunmaska (yet)](#not-in-bunmaska-yet).

## Methods

Objects created with `new BrowserWindow` have the following instance methods.

### `win.loadURL(url)`

`loadURL(url: string): void`

Navigates the window's web contents to a URL (remote `http(s)://` or local `file://`). Delegates to `webContents.loadURL`. Unlike Electron, this returns `void`, not a `Promise` - await navigation via `webContents` events if you need to.

```ts
const win = new BrowserWindow();
win.loadURL('https://example.com');
```

### `win.loadFile(filePath)`

`loadFile(filePath: string): void`

Loads a local HTML file into the window's web contents. Delegates to `webContents.loadFile`. Returns `void`.

```ts
const win = new BrowserWindow();
win.loadFile('index.html');
```

### `win.setTitle(title)`

`setTitle(title: string): void`

Changes the title of the native window.

```ts
win.setTitle('Editing - untitled.txt');
```

### `win.getTitle()`

`getTitle(): string`

Returns the current title of the native window. (As in Electron, this can differ from the page's `document.title`.)

```ts
console.log(win.getTitle());
```

### `win.setSize(width, height)`

`setSize(width: number, height: number): void`

Resizes the window to `width` by `height`. There is no `animate` argument.

```ts
win.setSize(1280, 720);
```

### `win.getSize()`

`getSize(): [number, number]`

Returns the window's `[width, height]` in pixels (derived from `getBounds()`).

```ts
const [w, h] = win.getSize();
```

### `win.getBounds()`

`getBounds(): { x: number; y: number; width: number; height: number }`

Returns the window's bounds as a rectangle. _Linux_ reports `x`/`y` as `0` (GTK4/Wayland forbid introspecting global window coordinates), so treat position as best-effort there.

```ts
const { x, y, width, height } = win.getBounds();
```

### `win.setResizable(resizable)`

`setResizable(resizable: boolean): void`

Enables or disables user resizing. On macOS this flips the `NSResizableWindowMask` style bit; on Linux it calls `gtk_window_set_resizable`.

```ts
win.setResizable(false);
```

### `win.isResizable()`

`isResizable(): boolean`

Returns whether the window is user-resizable (tracked from the constructor option and `setResizable`).

```ts
if (!win.isResizable()) { /* ... */ }
```

### `win.setMinimumSize(width, height)`

`setMinimumSize(width: number, height: number): void`

Constrains the window's minimum content size. _No-op on Windows_: enforcing a minimum size needs `WM_GETMINMAXINFO`, which the pump-routed native window proc can't intercept, so the value is tracked (and returned by `getMinimumSize`) but not enforced there.

```ts
win.setMinimumSize(400, 300);
```

### `win.getMinimumSize()`

`getMinimumSize(): [number, number]`

Returns the window's minimum `[width, height]`, or `[0, 0]` if none was set.

```ts
const [minW, minH] = win.getMinimumSize();
```

### `win.setOpacity(opacity)`

`setOpacity(opacity: number): void`

Sets window opacity, clamped to `[0, 1]` (`1` = fully opaque). Backed by `-[NSWindow setAlphaValue:]` on macOS and `gtk_widget_set_opacity` on Linux. (This is wired on both platforms - unlike Electron, where `setOpacity` is a no-op on Linux.)

```ts
win.setOpacity(0.85);
```

### `win.getOpacity()`

`getOpacity(): number`

Returns the last-set opacity in `[0, 1]`.

```ts
console.log(win.getOpacity()); // 0.85
```

### `win.center()`

`center(): void`

Centers the window on the current screen. _macOS only_ in practice: on _Linux_ this is a deliberate no-op, since GTK4 removed programmatic positioning and Wayland forbids clients from moving themselves (the compositor places the window).

```ts
win.center();
```

### `win.show()`

`show(): void`

Shows the window and brings it to the front. Emits `show` (and, via the focus path, may emit `focus`).

```ts
const win = new BrowserWindow({ show: false });
win.once('ready-to-show', () => win.show());
```

### `win.hide()`

`hide(): void`

Hides the window. Emits `hide`.

```ts
win.hide();
```

### `win.isVisible()`

`isVisible(): boolean`

Returns whether the window is currently visible.

```ts
if (win.isVisible()) win.hide();
```

### `win.focus()`

`focus(): void`

Gives the window keyboard focus and brings it forward.

```ts
win.focus();
```

### `win.isFocused()`

`isFocused(): boolean`

Returns whether the window is the key/active window.

```ts
if (win.isFocused()) { /* ... */ }
```

### `win.minimize()`

`minimize(): void`

Minimizes the window to the Dock/taskbar.

```ts
win.minimize();
```

### `win.isMinimized()`

`isMinimized(): boolean`

Returns whether the window is minimized.

```ts
if (win.isMinimized()) win.restore();
```

### `win.restore()`

`restore(): void`

Restores the window from a minimized state.

```ts
win.restore();
```

### `win.maximize()`

`maximize(): void`

Maximizes (macOS: zooms) the window. On macOS it no-ops if already zoomed.

```ts
win.maximize();
```

### `win.unmaximize()`

`unmaximize(): void`

Restores the window from a maximized state.

```ts
win.unmaximize();
```

### `win.isMaximized()`

`isMaximized(): boolean`

Returns whether the window is maximized (macOS: zoomed).

```ts
console.log(win.isMaximized());
```

### `win.setFullScreen(flag)`

`setFullScreen(flag: boolean): void`

Enters or leaves fullscreen mode. On macOS this toggles native fullscreen (only when the state actually needs to change); on Linux it calls `gtk_window_fullscreen` / `unfullscreen`.

```ts
win.setFullScreen(true);
```

### `win.isFullScreen()`

`isFullScreen(): boolean`

Returns whether the window is in fullscreen mode.

```ts
if (win.isFullScreen()) win.setFullScreen(false);
```

### `win.setAlwaysOnTop(flag)`

`setAlwaysOnTop(flag: boolean): void`

Sets whether the window floats above other windows. _macOS only_: backed by `-[NSWindow setLevel:]` (floating level). On _Linux_ this is a best-effort no-op - GTK4 dropped the keep-above hint and offers no portable client API.

```ts
win.setAlwaysOnTop(true); // honored on macOS, no-op on Linux
```

### `win.close()`

`close(): void`

Tries to close the window, routing through the same path as the user clicking the title-bar close button. A `close` listener may veto it via `event.preventDefault()`. If not vetoed, the `closed` event fires.

```ts
win.on('close', (e) => {
  if (hasUnsavedChanges) e.preventDefault();
});
win.close();
```

### `win.destroy()`

`destroy(): void`

Force-closes the window without consulting `close` listeners. The `closed` event still fires.

```ts
win.destroy();
```

### `win.isDestroyed()`

`isDestroyed(): boolean`

Returns whether the window has been closed/destroyed. After `closed`, drop your reference and stop using the instance.

```ts
if (!win.isDestroyed()) win.focus();
```

## Static methods

### `BrowserWindow.getAllWindows()`

`static getAllWindows(): BrowserWindow[]`

Returns all open windows in creation order.

```ts
import { BrowserWindow } from 'bunmaska';

for (const win of BrowserWindow.getAllWindows()) {
  win.close();
}
```

### `BrowserWindow.fromId(id)`

`static fromId(id: number): BrowserWindow | undefined`

Returns the window with the given `id`, or `undefined` if none. Note: unlike Electron (which returns `null`), the miss value here is `undefined`.

```ts
const win = BrowserWindow.fromId(1);
win?.focus();
```

## Events

`BrowserWindow` is an `EventEmitter`. The following events are emitted.

### Event: 'closed'

Emitted when the window has been closed. After receiving it, remove your reference to the window and stop using it.

```ts
win.on('closed', () => {
  console.log('window gone');
});
```

### Event: 'close'

Returns: `event` - an object with `preventDefault()` and a `defaultPrevented` getter.

Emitted when the window is about to close. Calling `event.preventDefault()` vetoes the close and keeps the window open. This is the hook for "unsaved changes?" prompts.

```ts
win.on('close', (event) => {
  if (hasUnsavedWork()) {
    event.preventDefault();
  }
});
```

### Event: 'focus'

Emitted when the window gains focus. (Also drives `app`'s `browser-window-focus`.)

```ts
win.on('focus', () => console.log('focused'));
```

### Event: 'blur'

Emitted when the window loses focus. (Also drives `app`'s `browser-window-blur`.)

```ts
win.on('blur', () => console.log('blurred'));
```

### Event: 'show'

Emitted when the window is shown.

### Event: 'hide'

Emitted when the window is hidden.

### Event: 'resize'

Emitted after the window has been resized.

### Event: 'maximize'

Emitted when the window is maximized.

### Event: 'unmaximize'

Emitted when the window leaves a maximized state.

### Event: 'minimize'

Emitted when the window is minimized.

### Event: 'restore'

Emitted when the window is restored from a minimized state.

### Event: 'ready-to-show'

Emitted when the page has been rendered (while not yet shown) and the window can be displayed without a visual flash. The standard pattern is to construct with `show: false` and show on this event.

```ts
const win = new BrowserWindow({ show: false });
win.once('ready-to-show', () => win.show());
win.loadURL('https://example.com');
```

## Properties

### `win.id` _Readonly_

A process-unique `number` identifying the window, matching Electron's `BrowserWindow.id`. Used as the key for `BrowserWindow.fromId`.

```ts
const win = new BrowserWindow();
console.log(win.id); // e.g. 1
```

### `win.webContents` _Readonly_

The `WebContents` this window owns. All page-related operations (navigation, IPC, JS execution) go through it. See the WebContents reference for its methods and events.

```ts
const win = new BrowserWindow();
win.webContents.on('did-finish-load', () => {
  win.webContents.executeJavaScript('document.title');
});
```

## Not in Bunmaska (yet)

Bunmaska implements the window-management core but omits large swaths of Electron's `BrowserWindow` surface. Notable gaps:

- **`setPosition` / `getPosition` / `setBounds` / `setContentBounds` / `getContentBounds` / `getNormalBounds`** - no positional setters; only `setSize` and `getBounds`/`getSize` exist. (On Linux, position is fundamentally constrained by GTK4/Wayland anyway.)
- **`setContentSize` / `getContentSize` / `getMaximumSize` / `setMaximumSize`** - only the minimum-size pair and `setSize` are wired.
- **`setMovable` / `setMinimizable` / `setMaximizable` / `setClosable` / `setFocusable`** and their getters - the constraint setters beyond `setResizable` are absent.
- **`setBackgroundColor` / `getBackgroundColor`, `setHasShadow` / `hasShadow`, `setVibrancy`** - no appearance/material APIs.
- **`setIcon`, `setProgressBar`, `flashFrame`, `setSkipTaskbar`, `setKiosk` / `isKiosk`, `setMenu` / `removeMenu`** - taskbar/dock/menu-bar and kiosk controls are not implemented.
- **`capturePage`, `getNativeWindowHandle`, `getMediaSourceId`, `moveTop` / `moveAbove`, `setAspectRatio`** - missing.
- **Parent/child & modal windows** - no `parent`/`modal` constructor options, and no `setParentWindow` / `getParentWindow` / `getChildWindows`. Child and modal windows don't exist yet.
- **macOS tabbing, Touch Bar, simple-fullscreen, represented file, traffic-light positioning, content protection** - none of the macOS-only flair (`setSimpleFullScreen`, `addTabbedWindow`, `setTouchBar`, `setRepresentedFilename`, `setWindowButtonVisibility`, `setContentProtection`, …) is wired.
- **`BrowserWindow.getFocusedWindow` / `fromWebContents`** - only `getAllWindows` and `fromId` are exposed as statics.
- **Events** - `page-title-updated`, `enter-full-screen` / `leave-full-screen`, `move` / `moved`, `will-resize` / `resized`, `always-on-top-changed`, and the various platform-specific gesture events (`swipe`, `rotate-gesture`, `app-command`, …) are not emitted. The implemented set is the lifecycle list above.
- **Constructor options** - beyond the seven documented keys (plus `webPreferences.preload`), the rest of `BrowserWindowConstructorOptions` (e.g. `backgroundColor`, `transparent`, `alwaysOnTop`, `parent`, `modal`, `minWidth`/`minHeight`, `titleBarStyle`, the full `webPreferences` bag) is ignored.

If you need one of these, it's genuinely not there - not hidden behind a flag.

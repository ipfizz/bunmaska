---
title: API Parity & Gaps
description: "Which Electron APIs work in Bunmaska on macOS, Linux and Windows, what behaves differently, and what to do when something is missing."
seoTitle: "Electron API parity matrix - per module, per platform"
order: 2
---

We're allergic to lying in tables, so here's the honest map. Bunmaska implements **~21 of Electron's main-process modules**, which covers most of what a typical webview app uses. It runs on **three platforms**, and none of them bundles Chromium:

- **macOS** uses AppKit and the system's own WebKit (`WKWebView`).
- **Linux** uses GTK 4 and the system's WebKitGTK 6.
- **Windows** uses Win32 and **WinCairo**, a Windows build of WebKit. Windows has no system WebKit, so Bunmaska builds WinCairo from source, and your Windows app has to carry it. Embed it with `engine.embed: true` or `bunmaska build --embed-engine <dir>`. Without an engine, the app refuses to start. See [Building for Windows](/docs/building#windows).

Support is not the same on every platform, and we won't pretend it is. Start with the table for the one-line summary, then read the module's section below it for the details. Electron methods Bunmaska has not built at all are listed at the bottom of each API page, under "Not in Bunmaska (yet)" (for example, [app](/docs/api/app#not-in-bunmaska-yet)).

## How to read the table

- <span class="st st-full" role="img" aria-label="full"></span> **Full.** Everything Bunmaska offers in this module works on this OS. A few differences from Electron apply on every OS, such as async clipboard reads, JSON IPC or media keys in `globalShortcut`. The note and the module's section list them.
- <span class="st st-partial" role="img" aria-label="partial"></span> **Partial.** It works on this OS, with gaps you should plan around. The note and the module's section say exactly which.
- <span class="st st-blocked" role="img" aria-label="engine-blocked"></span> **Engine-blocked.** It can't be built on this OS today, because the WebKit build Bunmaska uses there lacks the piece it needs. `printToPDF` and `capturePage` reject with `UnsupportedPlatformError`. `protocol.handle` is the exception: it registers without an error but never serves anything (see [`protocol`](#protocol)). This changes only if WebKit adds the missing piece. See [why](#why-some-things-cant-work-on-an-os).
- <span class="st st-none" role="img" aria-label="not implemented"></span> **Not implemented.** Not built on this OS yet, though nothing in the platform stops it. Calling it throws `UnsupportedPlatformError`, or rejects with it when the method returns a Promise. To fall back, catch it: import `UnsupportedPlatformError` from `bunmaska/main`, or check `err.code === 'ERR_UNSUPPORTED_PLATFORM'`. [Still to do](#still-to-do) says what is planned.

### Linux opt-in switches

Four Linux features stay off until your app turns them on, because they talk to the desktop's message bus (D-Bus) or keyring. Keeping them off by default also keeps our CI machines away from those services.

- The tray: `BUNMASKA_ENABLE_LINUX_TRAY`
- `powerMonitor`: `BUNMASKA_ENABLE_LINUX_POWER`
- `powerSaveBlocker`: `BUNMASKA_ENABLE_LINUX_POWER_BLOCKER`
- `safeStorage`: `BUNMASKA_ENABLE_LINUX_KEYRING`

Your users don't set anything. Your main process does, at the top of `main.ts`, before `app.whenReady()` and before the first call, for example `process.env.BUNMASKA_ENABLE_LINUX_TRAY = '1'`. Set it early: `safeStorage`, `powerMonitor` and `powerSaveBlocker` check once and remember the answer.

## The matrix

| Module | macOS | Linux | Windows | Notes |
| --- | :---: | :---: | :---: | --- |
| `app` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | [Lifecycle, quit, paths and locale work everywhere. Windows has no about panel.](#app) |
| `BrowserWindow` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | [On Linux your app can't position its windows or tell when the user minimizes one. Windows reports moves and resizes only when a drag ends.](#browserwindow) |
| `webContents` (core) | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | [Loading, navigation, scripts and IPC work everywhere. Windows has no DevTools or pop-up handler yet.](#webcontents-core) |
| `webContents.printToPDF` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-none" role="img" aria-label="not implemented"></span> | <span class="st st-blocked" role="img" aria-label="engine-blocked"></span> | [macOS only.](#webcontentsprinttopdf) |
| `webContents.capturePage` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-blocked" role="img" aria-label="engine-blocked"></span> | [macOS and Linux. Not possible on Windows today.](#webcontentscapturepage) |
| `webContents.sendInputEvent` | <span class="st st-none" role="img" aria-label="not implemented"></span> | <span class="st st-none" role="img" aria-label="not implemented"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | [Windows only, without modifier keys.](#webcontentssendinputevent) |
| `ipcMain` / `ipcRenderer` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | [Works everywhere. Messages are sent as JSON, so send plain data only.](#ipcmain-and-ipcrenderer) |
| `contextBridge` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | [On Windows the preload is not isolated from the page.](#contextbridge) |
| `Menu` / `MenuItem` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | [Menu keyboard shortcuts work on macOS only.](#menu-and-menuitem) |
| `dialog` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | [Dialogs never attach to a window. Windows can't show custom button labels.](#dialog) |
| `clipboard` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | [Text, HTML and images everywhere. Reads return Promises.](#clipboard) |
| `Tray` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | [No tray menu on Linux or Windows yet. Linux needs an opt-in switch.](#tray) |
| `Notification` | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | [macOS needs a packaged `.app`. No `click` event anywhere.](#notification) |
| `nativeImage` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | [Works everywhere. Windows ignores JPEG quality.](#nativeimage) |
| `nativeTheme` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | [Forcing light or dark with `themeSource` restyles the page on macOS only.](#nativetheme) |
| `globalShortcut` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-full" role="img" aria-label="full"></span> | [Linux works under X11 only. Media keys don't register anywhere.](#globalshortcut) |
| `shell` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | [Works everywhere. Linux can't highlight the file in its folder.](#shell) |
| `protocol` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-blocked" role="img" aria-label="engine-blocked"></span> | [Custom schemes like `app://` serve on macOS and Linux. Not possible on Windows today.](#protocol) |
| `screen` | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | [No display-change events anywhere. Linux can't read the cursor or work area.](#screen) |
| `powerMonitor` | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | [Sleep, wake, lock and unlock only. Linux needs an opt-in switch.](#powermonitor) |
| `powerSaveBlocker` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-full" role="img" aria-label="full"></span> | [Blocks idle sleep. Linux needs an opt-in switch, and both types do the same thing there.](#powersaveblocker) |
| `safeStorage` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-full" role="img" aria-label="full"></span> | [One key shared by every Bunmaska app. Linux needs an opt-in switch.](#safestorage) |
| `session` | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | [One default session. Cookies on macOS and Linux only.](#session) |
| `autoUpdater` | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | [Signed updates download, install and relaunch on all three. Unlike Electron, you start the download yourself, and `.deb` installs can't update themselves.](#autoupdater) |
| Accelerator strings, `app.getPath` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | [Parse and resolve the same on all three.](#accelerator-strings-and-appgetpath) |
| `requestSingleInstanceLock` | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-full" role="img" aria-label="full"></span> | <span class="st st-partial" role="img" aria-label="partial"></span> | [Not yet tested on Windows.](#requestsingleinstancelock) |

## Module by module

### `app`

Works like Electron on all three: `whenReady`, the quit sequence, `getPath`, name and version, and locale. The single-instance lock works too, though it is not yet tested on Windows (see [`requestSingleInstanceLock`](#requestsingleinstancelock)).

Quitting follows Electron's order. `app.quit()` fires `before-quit`, then closes every window, then fires `will-quit` and `quit`. Any window's `close` listener can cancel the quit, and so can `before-quit` and `will-quit`. Page `beforeunload` handlers don't run and can't cancel it. The `quit` menu role runs the same sequence on every OS. On macOS, Cmd+Q, the Dock's Quit and logging out run it too.

- **macOS:** everything above, plus `app.dock`, the badge count, `hide`/`show`, the about panel, and the `activate`, `open-url` and `open-file` events.
- **Linux:** `showAboutPanel()` opens a plain GTK about dialog. Your app's name and version are not filled in on it yet.
- **Windows:** Windows has no standard about panel, so `showAboutPanel()` does nothing.
- **Linux and Windows:**
  - `app.dock` is `undefined`, as in Electron.
  - `setBadgeCount` shows nothing and returns `false`, though `getBadgeCount` still returns what you set.
  - `hide`, `show` and `setActivationPolicy` do nothing, and `isHidden()` / `isActive()` return `false`.
  - `activate`, `open-url` and `open-file` never fire, because they come from macOS itself.

### `BrowserWindow`

Works like Electron on macOS. `getBounds`, `setBounds` and `setPosition` use the window's real on-screen frame, measured from the top-left corner of the primary display, as Electron does. The `move` event fires when the user drags the window.

On every OS, `BrowserWindow.fromWebContents` and `getFocusedWindow` work, and a closed window (or its `webContents`) throws `TypeError: Object has been destroyed` when you use it, as in Electron. Check `isDestroyed()` first if you are unsure.

- **Linux:** GTK 4 gives apps no way to place their own windows, and Wayland forbids it outright. The desktop decides where windows go. So on Linux:
  - `setPosition` and `center` do nothing.
  - `setBounds` applies the size and ignores `x` and `y`.
  - `getBounds` and `getPosition` always report `x` and `y` as `0`.
  - The `move` event never fires.
  - `setAlwaysOnTop` does nothing, because GTK 4 dropped that feature.
  - `setSize` sets the size of the content area, not the outer frame.
  - The `minimize` and `restore` events never fire. `isMinimized()` is `true` only after you call `minimize()` yourself. It can't see the user minimizing the window.
- **Windows:** geometry, the `move` event and `setMinimumSize` work. Two gaps:
  - While the user drags or resizes a window, `move` and `resize` arrive when they let go of the mouse, not continuously.
  - To your code, a closed window behaves as on the other OSes: `closed` fires, and using it throws `Object has been destroyed`. Behind the scenes, Bunmaska only hides the native window and loads a blank page into it, because tearing down a live WebKit view crashes on Windows today. That memory is freed only when the app exits, so an app that opens and closes many windows uses more memory over time.

Parent, child and modal windows are not implemented on any OS. The [BrowserWindow page](/docs/api/browser-window#not-in-bunmaska-yet) lists the rest.

### `webContents` (core)

Loading pages, navigation events, `executeJavaScript`, zoom, `insertCSS` and `send` work on all three.

Bunmaska can't create child windows yet, so `window.open` and `target="_blank"` links are always blocked, on every OS. On macOS and Linux your `setWindowOpenHandler` handler is still called with the URL. Returning `{ action: 'allow' }` logs a warning and the window stays blocked. The practical pattern: open the URL with `shell.openExternal(url)` and return `{ action: 'deny' }`.

- **macOS:** `openDevTools()` opens the Web Inspector through a private WebKit API. If that API is missing, it logs a warning instead of throwing. `alert()`, `confirm()` and file inputs open native sheets. `prompt()` returns `null`, as in Electron.
- **Linux:** `openDevTools()` opens the WebKitGTK inspector.
- **Windows:** two gaps.
  - `setWindowOpenHandler` is never called. Setting one logs a warning. So on Windows, `window.open` and `target="_blank"` links silently do nothing, and main never learns the URL. If your page has external links, catch the click in your preload and send the URL to main, which opens it with `shell.openExternal`.
  - `openDevTools()` does nothing but log a warning. The WinCairo inspector is not wired up yet.
- **Linux and Windows:** Bunmaska adds no handling of its own for `alert()`, `confirm()`, `prompt()` and file inputs. What happens is whatever that WebKit build does by default, and we haven't documented it per OS yet. Test them there, or have main show a [`dialog`](#dialog) over IPC when you need a predictable result.

### `webContents.printToPDF`

- **macOS:** works. Resolves to the PDF bytes. Options such as page size and margins are ignored (TypeScript flags them).
- **Linux:** rejects with `UnsupportedPlatformError`. WebKitGTK has no call that hands back PDF bytes, but it can print to a file. Printing to a temporary PDF and reading it back would work. It just isn't wired up yet.
- **Windows:** engine-blocked. Rejects with `UnsupportedPlatformError`. WinCairo has no PDF export at all.

### `webContents.capturePage`

- **macOS and Linux:** resolves to a [`NativeImage`](/docs/api/native-image) of the visible part of the page. A `rect` argument is ignored (TypeScript flags it). To capture part of the page, crop the result with `crop()`.
- **Windows:** engine-blocked. Rejects with `UnsupportedPlatformError`. WinCairo can only take a snapshot from inside the page's own process, which Bunmaska can't reach from the app.

### `webContents.sendInputEvent`

Sends a real mouse or keyboard event into the page. The page sees `isTrusted === true`, which a script-dispatched event can never fake. That matters for widgets that ignore synthetic clicks.

- **macOS and Linux:** throws `UnsupportedPlatformError`.
- **Windows:** works for `mouseDown`, `mouseUp`, `mouseMove`, `keyDown`, `keyUp` and `char`. It works on a hidden window and never steals the user's focus. Any other type, such as `mouseWheel` or `mouseEnter`, throws a `TypeError`. A malformed event, such as a mouse event whose `x` isn't a finite number, also throws a `TypeError` instead of firing.

Limits on Windows:

- There are no modifier keys. A `modifiers` array is ignored (TypeScript flags it). Shift, Ctrl and Alt come from the physical keyboard, so you can't send Ctrl+A.
- `keyDown` and `keyUp` know letters, digits and these named keys: Enter, Tab, Escape, Backspace, Space, Delete, the arrows, Home, End, PageUp and PageDown. Any other key, F1-F24 included, silently does nothing. `char` types any single character.
- For the keys it knows, the event carries the key's US-layout scan code, the same layout Electron uses for `KeyboardEvent.code`.
- A synthesized hover ends at once while the real mouse pointer is outside the window, so hover menus close immediately.
- Coordinates are only guaranteed at 100% display scaling. Support for scaled displays is still to come.

### `ipcMain` and `ipcRenderer`

Works on all three: `ipcMain.handle` and `on`, `event.reply`, `ipcRenderer.invoke`, `send` and `on`, and `webContents.send`. As in Electron, `invoke` has no timeout, and an error thrown in a handler reaches the page as its message only.

Differences on every OS:

- **Messages travel as JSON, not Electron's structured clone.** Send plain data: strings, numbers, booleans, arrays and plain objects.
  - A `Map`, `Set`, `ArrayBuffer`, typed array, function, symbol or `bigint` is refused in both directions, instead of arriving mangled.
  - Sent from the preload (`ipcRenderer.send` or `invoke`), it throws a `TypeError`.
  - Sent from main (`webContents.send`, `event.reply`), it throws an `InvalidArgumentError`. If an `ipcMain.handle` handler returns one, the page's `invoke` rejects.
  - A `Date` arrives as an ISO string, and properties set to `undefined` disappear.
  - A Node `Buffer` sent from main is the one exception. It is not refused, and arrives as `{ type: 'Buffer', data: [...] }`. To send binary data either way, convert it to base64 first.
- **`ipcRenderer.sendSync` doesn't exist.** Switch those calls to `invoke`.
- **The `event` an `ipcRenderer.on` listener receives is an empty object**, so `event.sender` and `event.ports` aren't there.
- **`ipcRenderer` belongs in your preload.** Expose what the page needs with [`contextBridge`](#contextbridge), as with Electron's `contextIsolation: true`.

Who can reach your handlers:

- **macOS and Linux:** a page script can't reach `ipcRenderer` at all. It gets a `BunmaskaError` pointing at `contextBridge`.
- **Windows:** the preload is not isolated (see [`contextBridge`](#contextbridge)), so any script on the page, third-party ones included, can call your handlers. If a window may load content you don't control, check `event.sender.getURL()` in the handlers that matter.

`MessagePort` and `postMessage` are not implemented.

### `contextBridge`

- **macOS and Linux:** your preload runs in its own isolated JavaScript world, like Electron with `contextIsolation: true`. The page can't see the preload's globals.
- **Windows:** the preload runs in the same JavaScript context as the page, like Electron with `contextIsolation: false`. WinCairo can't create a separate context without a native plugin inside the engine, which Bunmaska doesn't ship yet. `exposeInMainWorld` still works, but any script on the page, third-party ones included, can read and change what the preload sets up. Don't rely on the preload as a security boundary on Windows.

On every OS:

- Every function you expose is async on the page side and returns a `Promise`, even if your implementation is synchronous. Each call is passed between the two worlds as a message rather than made directly. Design the API as async from the start.
- Arguments and return values are copied (structured clone), so only data crosses. That breaks Electron's common `window.api.onSomething(callback)` pattern, because the page can't hand a callback to the preload. Keep the `ipcRenderer.on` listener in the preload, and have the page ask for the latest value through an exposed async function. See [Forwarding events from the preload](/docs/api/context-bridge#forwarding-events-from-the-preload).
- Calls have no timeout, as in Electron.
- The preload and the bridge run in the top frame only, not in iframes.

### `Menu` and `MenuItem`

The application menu bar and context menus work on all three. `click(menuItem, window, event)` receives the focused window, as in Electron. The `event` argument is empty: no modifier keys, no `triggeredByAccelerator`.

Checkbox and radio items toggle themselves. After a `MenuItem` is built, only `checked` can change. `label` and `enabled` are read-only, so to change one, build the menu again and set it again.

On macOS, an app that sets no menu gets Electron's default one once it is ready: an app menu (About, Hide, Quit), File > Close Window, and the standard Edit and Window menus. So Cmd+Q and copy/paste work out of the box. Call `Menu.setApplicationMenu` (even with `null`) before `ready` to skip it. Linux and Windows get no default menu bar, where Electron gives you one.

Roles (`copy`, `quit`, `minimize` and so on):

- **macOS:** every role works, exactly like the native menu item.
- **Linux:** the editing roles (undo, redo, cut, copy, paste, delete, select all), the window roles (minimize, close, zoom, toggle fullscreen) and `quit` work. `about`, `hide`, `hideOthers` and `unhide` appear but do nothing when clicked.
- **Windows:** the window roles and `quit` work. The editing roles and `about`, `hide`, `hideOthers` and `unhide` appear but do nothing, because WinCairo has no call for editing commands like copy and paste.

Keyboard shortcuts (`accelerator`) work on macOS only. On Linux and Windows the shortcut is neither bound nor shown next to the label, so pressing it does nothing. If you need one there today, listen for the key in your page and tell main over IPC.

`popup()`:

- On macOS and Windows, `popup()` doesn't return until the menu closes. On Linux it returns right away.
- There is no `callback` option and no `menu-will-close` event.
- `x` and `y` are relative to the window's content area and default to its top-left corner, not the mouse position. To open a context menu at the mouse, pass the position from the page's `contextmenu` event (`clientX`, `clientY`).

### `dialog`

Open, save, message and error dialogs work on all three. Every method returns a `Promise`. There are no `*Sync` variants.

- **Every OS:** you can pass a window as the first argument, as in Electron, so ported code runs. The window is ignored, though. Dialogs open as separate windows, never as sheets attached to yours.
- **Every OS:** `showErrorBox` doesn't wait for the user to close it, where Electron's does.
- **Linux:** a message box's `type` (`info`, `warning`, `error` and so on) has no effect, because GTK's alert dialog has no severity icon.
- **Windows:** message boxes can only show Windows' standard buttons, so your labels are replaced.
  - One button shows OK.
  - Two show OK/Cancel if one of yours is labeled "Cancel" or "No", otherwise Yes/No.
  - Three or more show Yes/No/Cancel. A fourth button onward can't be reached.
  - The result is still your button's index. Cancel and Esc return your "Cancel" or "No" button (or `0` if you have none). Yes/OK and No return your other buttons, in order. For example, `['Save', "Don't Save", 'Cancel']` shows Yes/No/Cancel and returns `0`, `1` and `2`.
- **Windows:** the folder picker ignores `defaultPath`. A save dialog's `defaultPath` can be a file name or a full file path, but not a bare folder.
- **Linux and Windows:** one dialog can't pick both files and folders, so `openDirectory` wins over `openFile`, as in Electron.

### `clipboard`

Text, HTML and images work on all three.

Reads (`readText`, `readHTML`, `readImage`) return a `Promise` on every OS, where Electron's are synchronous. GTK 4 on Linux can only read the clipboard asynchronously, and Bunmaska keeps one API everywhere, so `await` your reads. Writes stay synchronous.

The Linux selection clipboard, RTF, bookmarks and the combined `write()` are not implemented.

### `Tray`

- **macOS:** icon, tooltip, title, context menu and the `click` event all work. When a context menu is set, clicking opens the menu, so `click` fires only when no menu is set.
- **Linux:** off by default. Turn it on with the `BUNMASKA_ENABLE_LINUX_TRAY` [opt-in switch](#linux-opt-in-switches).
  - When it is off, or the desktop's message bus can't be reached, `new Tray()` still works but shows nothing, so the same code runs on every OS.
  - When on, the icon uses StatusNotifierItem, the tray standard that KDE, Waybar, swaybar and GNOME (with the AppIndicator extension) draw.
  - `click` fires when the desktop activates the icon. `setContextMenu` is accepted, but no menu shows yet.
- **Windows:** icon, tooltip and left-click `click` work. `setContextMenu` is accepted, but no menu shows yet. `setTitle` does nothing, because Windows tray icons have no text. Right-click and double-click are not reported.

On every OS, `click` carries no event, bounds or position.

### `Notification`

`new Notification({ title, body, subtitle, silent }).show()` works on all three. Those four are the only options; others such as `icon`, `actions` and `urgency` are ignored (TypeScript flags them). `silent` is honored everywhere. Changing a property after `show()` doesn't update the notification on screen. `click`, `reply` and `action` events are not delivered on any OS yet.

- **macOS:** notifications only appear from a packaged `.app`. Under `bunmaska dev` or `bun main.ts`, nothing shows and `Notification.isSupported()` returns `false`, so check it first. The `close` event never fires.
- **Linux:** shown through libnotify. `close` fires when the user or the system dismisses the notification. `subtitle` is ignored.
- **Windows:** a basic balloon notification from the notification area. `close` fires when it is dismissed. `subtitle` becomes the first line of the body. Rich notifications with buttons, images or replies are still to come.

### `nativeImage`

Loading an image (from a path, a buffer or a data URL), encoding it as PNG or JPEG, `resize` and `crop` all work on all three. `toJPEG` defaults `quality` to `92`, where Electron requires you to pass it.

- **Windows:** `toJPEG(quality)` ignores `quality` and uses the encoder's default. `.ico` files get no special handling, so which of the icon's sizes you get is up to Windows. Pass PNG or JPEG instead.
- **Every OS:** `resize` accepts Electron's `quality` hint, but it doesn't pick a different scaling algorithm.
- **macOS only:** template images (`setTemplateImage`) recolor for light and dark menu bars. Elsewhere the flag is kept but has no visible effect.

### `nativeTheme`

`shouldUseDarkColors` reads the real OS setting on all three. `themeSource` can force `'light'` or `'dark'` on all three: `shouldUseDarkColors` follows it, and setting it always emits `updated`.

- **macOS:** forcing `themeSource` also restyles your windows, and the page's `prefers-color-scheme` follows. When the user switches dark mode, `updated` fires.
- **Linux:** when the user switches dark mode, `updated` fires. Forcing `themeSource` only changes what `shouldUseDarkColors` reports. Native widgets and the page's `prefers-color-scheme` don't follow, so drive your page's theme from `shouldUseDarkColors`.
- **Windows:** forcing `themeSource` works as on Linux. Windows doesn't tell Bunmaska when the user switches dark mode, so `updated` doesn't fire for it. `shouldUseDarkColors` reads the setting fresh each time, so checking it again (for example when a window gains focus) picks up the change.
- **Linux and Windows:** `prefersReducedTransparency` is always `false`.

### `globalShortcut`

System-wide shortcuts that fire even when your app is not focused.

- **macOS:** works, even when the app is not packaged.
- **Windows:** works.
- **Linux:** works under X11 only. Linux desktops run on one of two display systems, X11 or Wayland, and Ubuntu and Fedora default to Wayland. Under Wayland, `register` returns `false` and nothing is grabbed, even through XWayland. Supporting Wayland means asking the desktop for permission through its global-shortcuts service, which Bunmaska doesn't do yet. Check the return value of `register` and offer an in-app shortcut as a fallback. Under X11, shortcuts fire regardless of NumLock and CapsLock.
- **Every OS:** media and volume keys (`MediaPlayPause`, `VolumeUp` and friends) parse, but `register` returns `false` for them. The numpad keys and `Insert` work. An accelerator that can't be parsed makes `register` return `false` instead of throwing.

### `shell`

`openExternal`, `openPath`, `showItemInFolder` and `beep` work on all three.

- **Linux:** `showItemInFolder` opens the folder that contains the item, but can't highlight the item itself.
- **macOS and Windows:** `showItemInFolder` quietly does nothing for a path it can't use: an empty path on macOS, and on Windows a relative path or one containing a double quote. Pass an absolute path, for example from `path.resolve`.
- **Every OS:** `openExternal` resolves to `true` or `false` instead of rejecting, and takes no options. It needs a full URL with a scheme, such as `https://...` or `mailto:...`. A bare file path or program name resolves to `false`. Open files with `shell.openPath`.

`trashItem` is not implemented on any OS.

### `protocol`

Serve your own URL scheme, such as `app://`, from the main process, so bundled files load without a local HTTP server.

- **macOS and Linux:** works.
- **Windows:** engine-blocked. WinCairo has no way to plug in a custom URL scheme. `protocol.handle` still registers without an error, but requests to the scheme are never served, and creating a window while a scheme is registered logs a warning. On Windows, load your files with `loadFile` instead.

On every OS:

- Custom schemes only. `handle` throws `InvalidArgumentError` for `http`, `https`, `file` and the other schemes WebKit serves itself. Electron can intercept those. WebKit can't.
- Register the scheme before you create the window that uses it. A web view reads the list of schemes once, when it is created.
- The handler receives only `{ url }`, with no method, headers or body. It must return synchronously: `{ data, mimeType }`, where `data` is a string or bytes and `mimeType` defaults to `text/html`. You can't set a status code or headers.
- Return `undefined` and the request fails with a network error. There is no 404.
- An Electron handler like `async (req) => new Response(...)` has to be rewritten, for example with `readFileSync`.

`registerSchemesAsPrivileged` and per-session protocols are not implemented.

### `screen`

Listing displays with their bounds, scale factor and multi-monitor positions works on all three. Coordinates start at the top-left corner of the primary display.

On every OS, `screen` emits no events: no `display-added`, `display-removed` or `display-metrics-changed`. It is a plain object, not an `EventEmitter`. Call `getAllDisplays()` again when you need fresh data.

- **macOS:** `getCursorScreenPoint()` and `workArea` (the screen minus the menu bar and Dock) are real, and so are `rotation` and `internal`.
- **Windows:** `getCursorScreenPoint()` and `workArea` (the screen minus the taskbar) are real. `rotation` is always `0` and `internal` is always `false`.
- **Linux:**
  - `getCursorScreenPoint()` always returns `{ x: 0, y: 0 }`.
  - `workArea` equals `bounds`, so desktop panels are not subtracted.
  - `rotation` is always `0` and `internal` is always `false`.
  - GTK 4 has no primary monitor, so `getPrimaryDisplay()` returns the first one.
  - Display ids are just positions in the list (`0`, `1`, `2` and so on). After a monitor is plugged in or removed, the same id can point to a different display, so don't store them.
  - Fractional scale factors such as `1.5` need GTK 4.14 or later. Older GTK reports a whole number.

### `powerMonitor`

The `suspend`, `resume`, `lock-screen` and `unlock-screen` events work on all three. The rest of Electron's `powerMonitor` is missing on every OS: no `getSystemIdleTime` or `getSystemIdleState`, no `isOnBatteryPower` or `on-ac` / `on-battery`, no `shutdown` event and no thermal state.

- **Linux:** off by default. Turn it on with the `BUNMASKA_ENABLE_LINUX_POWER` [opt-in switch](#linux-opt-in-switches). It also needs systemd-logind, Linux's login manager, on the system message bus. With it off, no events fire.
  - `suspend` is best-effort. Bunmaska doesn't ask the system to wait for it, so the event can arrive after the machine wakes. Don't count on it to finish work before the lid closes.
  - `lock-screen` and `unlock-screen` fire only when the lock goes through logind, for example `loginctl lock-session`. Lock screens that lock without telling logind don't trigger them, so test on the desktops you target before relying on these events.
- **Windows:** Windows sometimes refuses the lock listener, usually when the app starts right at login. Bunmaska then logs a warning, and `lock-screen` and `unlock-screen` stay silent until the app restarts.

### `powerSaveBlocker`

`start`, `stop` and `isStarted` work on all three. `start()` always returns an id, even when nothing native happens, so your code never has to handle `-1`.

- **macOS and Windows:** both `prevent-app-suspension` and `prevent-display-sleep` work. They block idle sleep only, as in Electron: closing the lid or choosing Sleep still puts the machine to sleep.
- **Linux:** off by default. Turn it on with the `BUNMASKA_ENABLE_LINUX_POWER_BLOCKER` [opt-in switch](#linux-opt-in-switches), which is separate from `BUNMASKA_ENABLE_LINUX_POWER`. With it off, `start()` returns an id and does nothing. With it on, both types do the same thing: they ask the desktop to hold off the screen saver and idle sleep.

### `safeStorage`

`isEncryptionAvailable`, `encryptString` and `decryptString` work. Strings are encrypted with AES-256-GCM, so a tampered blob makes `decryptString` throw instead of returning garbage.

- **macOS:** the key lives in the Keychain.
- **Windows:** the key is sealed with DPAPI, Windows' built-in per-user encryption. It is stored as `safestorage.key` in the folder `BUNMASKA_HOME` names, or in `.bunmaska` in the user's home folder when that isn't set.
- **Linux:** off by default. Turn it on with the `BUNMASKA_ENABLE_LINUX_KEYRING` [opt-in switch](#linux-opt-in-switches) to keep the key in the desktop keyring through libsecret.
  - With it off, or with no keyring, `isEncryptionAvailable()` returns `false` and `encryptString` / `decryptString` throw.
  - If the keyring is locked, the first `encryptString` or `decryptString` waits for the user to unlock it, and your main process is frozen until they do.

Two differences from Electron on every OS:

- **One key is shared by every Bunmaska app of the same user.** Electron keeps one per app. Any other Bunmaska app the same user runs can decrypt your app's data (macOS may ask the user first). Treat `safeStorage` as protection against other users and a stolen disk, not against other apps. A separate key per app is on the [to-do list](#still-to-do).
- **There is no plaintext fallback.** Without a keyring, Electron falls back to a weak built-in key. Bunmaska refuses and throws instead. Blobs are Bunmaska's own format and can't be read by Electron.

### `session`

There is one session, `session.defaultSession`. Partitions (`fromPartition`, `fromPath`) are not implemented.

- **Every OS:** `setUserAgent` sets the User-Agent for windows created after the call. Use `webContents.setUserAgent` for a window that already exists. `getUserAgent()` returns `''` until you set one, where Electron returns the default.
- **macOS and Linux:** `cookies.get`, `set` and `remove` work, matching cookies the way browsers do (RFC 6265).
  - `httpOnly` and `secure` are kept.
  - `sameSite` isn't supported: `set` ignores it (TypeScript flags it) and `get` doesn't report it. On macOS, every cookie you set is stored as `lax`.
  - `cookies.set` defaults `path` to `/`, not the URL's directory.
- **Windows:** every `cookies` method rejects with `UnsupportedPlatformError`. WinCairo has no way to read or write a single cookie; it can only delete them all.
- **`clearStorageData()`:**
  - macOS clears all website data: cookies, caches, local storage, IndexedDB and the rest.
  - Windows clears cookies and Cache API storage (`caches`) only, not the HTTP cache, local storage or IndexedDB.
  - Linux rejects with `UnsupportedPlatformError`. It is not wired up yet.
  - On every OS, passing the `origin` or `storages` options rejects rather than quietly clearing everything.
- **macOS, in development:** every Bunmaska app you run unpackaged (`bunmaska dev`, `bun main.ts`) shares one cookie jar and one set of web storage, across all your projects, because they all run as the same `bun` process. Logins and `localStorage` from one project show up in another. A packaged `.app` gets its own.

### `autoUpdater`

Your app can update itself on all three OSes. It doesn't use Squirrel, the update framework Electron relies on. Updating takes three steps.

1. **Check.** `checkForUpdates()` fetches `update.json` from your update feed and compares versions. Unlike Electron, it doesn't download anything. Call `downloadUpdate()` when `update-available` fires.
2. **Download and verify.** `downloadUpdate()` accepts only an update it can prove came from you.
   - **Setup:** `bunmaska keygen` makes a key pair, and `bunmaska build --update --update-key <private key>` signs each release.
   - **Check:** before trusting an update, the app checks a signature on `update.json` and one on the downloaded file, against the public key you pass to `setFeedURL({ url, publicKey })`. The file's size and hash must also equal the ones listed in the signed `update.json`.
   - **Why:** a hacked or spoofed update server can't push its own code to your users. A feed without valid signatures is refused.
3. **Install.** `quitAndInstall()` quits your app, then a small helper program swaps in the new version and starts it. If any step of the swap fails, the helper starts the old version again, so users are never left without a working app.

What to know before you ship:

- The install step is tested piece by piece, but our CI doesn't run a complete live update on a real install yet. Test your own update path end to end.
- `quitAndInstall()` can only replace the app layouts `bunmaska build` produces: the macOS `.app`, the Linux `.tar.gz` folder and the Windows portable folder. Anywhere else it throws without quitting. That includes `bunmaska dev`, `bun main.ts`, and a `.deb` install, whose files belong to the system's package manager. Ship `.deb` updates through your apt repository instead.
- The swap renames the folder your app lives in, so the user needs write access to it. If they don't have it (for example, the app sits under `C:\Program Files`), the swap fails and the old version starts again.
- `checkForUpdates()` rejects, and emits `error`, while the app's version is `0.0.0`. That is what `app.getVersion()` returns when your `package.json` has no `version`. An app that can't tell its own version would reinstall the same update forever, so set `version`.
- Each feed folder serves one OS and CPU architecture. If its `update.json` is for another OS or architecture, `checkForUpdates()` rejects and emits `error`. Host one folder per OS and architecture, and point `setFeedURL` at the matching one.
- The feed URL must be `https`. Plain `http` is allowed for `localhost` only, for testing.
- A `before-quit`, window `close` or `will-quit` listener that cancels the quit keeps the app running. The helper waits and installs once the app does exit.
- `before-quit-for-update` is not emitted. `update-downloaded` passes a single `{ version, releaseName }` object, without Electron's release notes, date or URL.

The full publishing flow is on the [autoUpdater page](/docs/api/auto-updater) and in [Building & Distribution](/docs/building#auto-updates).

### Accelerator strings and `app.getPath`

Accelerator strings such as `CmdOrCtrl+Shift+K` parse the same way on all three. `CmdOrCtrl` means Command on macOS and Control elsewhere. Whether a shortcut actually fires depends on where you use it: see [`Menu`](#menu-and-menuitem) and [`globalShortcut`](#globalshortcut).

`app.getPath` resolves every name it supports on all three. On Linux the user folders (`desktop`, `documents`, `downloads` and so on) come from the XDG settings, so localized folder names work. `recent` and `assets` are not supported.

### `requestSingleInstanceLock`

- **macOS and Linux:** works like Electron. A second launch passes its arguments, working directory and `additionalData` to the first instance as a `second-instance` event, never before `ready`.
- **Windows:** the lock itself is a plain file. The hand-off that fires `second-instance` in the first copy goes over a Unix domain socket (a local socket file), which hasn't been tested on Windows. If you rely on `second-instance`, for example to focus your window or open a file the user double-clicked, test it on Windows before you ship.

## Why some things can't work on an OS

These gaps aren't laziness. The platform underneath doesn't offer the piece Bunmaska would need.

### Windows: WinCairo is missing three entry points

WinCairo's programming interface lacks three things other WebKit builds have:

- **A custom URL scheme handler,** so `protocol` can't serve `app://` and friends.
- **PDF export.** The call macOS uses exists only in Apple's WebKit, so `printToPDF` has nothing to call.
- **A page snapshot from the app's side.** WinCairo's only snapshot calls run inside the web page's own process, which the app can't reach, so `capturePage` has nothing to call.

We confirmed each one by reading the list of functions `WebKit2.dll` exports. They become possible only if WinCairo adds them upstream.

The same interface explains two smaller Windows gaps. It can delete all cookies but not read or write one, which is why `session.cookies` rejects. It has no call for editing commands, which is why the copy and paste menu roles do nothing.

### Linux: the desktop owns window placement

GTK 4 removed the calls that let an app move its own window, and Wayland forbids it outright. The desktop decides where windows go and doesn't tell the app. That is why `setPosition`, `center`, the `x` and `y` of `getBounds`, the `move` event and `setAlwaysOnTop` don't work on Linux.

## Still to do

Gaps inside modules that already ship. We're filling them. Gaps mentioned above but not listed here, such as `sendInputEvent` on macOS and Linux, parent and child windows, `trashItem`, `MessagePort`, session partitions and `printToPDF` options, have no date yet.

**Every OS**

- `getSystemIdleTime` and `isOnBatteryPower` in `powerMonitor`.
- `click`, `reply` and `action` events for notifications.
- Display-change events in `screen`.
- Media and volume keys for `globalShortcut`.
- Child windows, so `setWindowOpenHandler` can `allow`.
- A separate `safeStorage` key per app.
- Richer `webContents` events.

**macOS**

- The `close` event for notifications.

**Linux**

- `session.clearStorageData`.
- `printToPDF`.
- The tray context menu.
- Menu keyboard shortcuts.
- The minimized state, and the `minimize` and `restore` events.
- The cursor position and the work area in `screen`.
- Global shortcuts under Wayland.
- Your app's name and version in the about dialog.

**Windows**

- The `setWindowOpenHandler` callback.
- DevTools.
- Live dark-mode changes in `nativeTheme`.
- The tray context menu.
- Menu keyboard shortcuts.
- An isolated world for the preload.
- JPEG quality in `nativeImage`.
- Rich notifications.
- Modifier keys, more keys and scaled displays in `sendInputEvent`.
- A test of the single-instance lock.
- Continuous `move` and `resize` events while the user drags.

## Where Bunmaska behaves differently from Electron

Differences in behavior today, on every OS unless noted. Some are by design, like JSON IPC and async `contextBridge`. Others, like the shared `safeStorage` key, are on the list to fix. Each is also documented on its API page.

- **IPC is JSON, not structured clone.** `Map`, `Set`, `ArrayBuffer`, typed arrays, functions, symbols and `bigint` throw in both directions. A `Date` arrives as a string, and a `Buffer` sent from main arrives as `{ type, data }`. `ipcRenderer.sendSync` doesn't exist. See [ipcRenderer](/docs/api/ipc-renderer#ipcrenderersendchannel-args).
- **`contextBridge` functions are always async** on the page side, and `ipcRenderer` exists only in the preload on macOS and Linux.
- **`protocol.handle` serves custom schemes only**, and its handler returns `{ data, mimeType }` synchronously instead of a `Response`. Electron can intercept `http`, `https` and `file`.
- **The default application menu exists on macOS only.** Linux and Windows get no menu bar until you set one.
- **`app.quit()` runs no `beforeunload` handlers.** Only main-process listeners and window `close` listeners can cancel it.
- **The `ready` event passes no arguments.**
- **`app.setPath` does not require the folder to exist.**
- **On macOS and Windows, `getPreferredSystemLanguages()` returns a single entry**, the same value as `getLocale()`.
- **`BrowserWindow.fromId` returns `undefined`** for an unknown id, not `null`.
- **`dialog`'s open, save and message methods return Promises** (no `*Sync` variants) and ignore the parent window. `showErrorBox` doesn't block. On Windows a save dialog's `defaultPath` can't be a bare folder.
- **`clipboard`, `shell` and `nativeImage` work in the main process only.** Call them there and expose what the page needs through IPC. Clipboard reads return Promises.
- **`shell.openExternal` resolves `true` or `false`** instead of rejecting on failure.
- **`cookies.set` defaults `path` to `/`**, not the URL's directory, and `session.getUserAgent()` returns `''` until you set one.
- **`safeStorage` shares one key across all Bunmaska apps** of a user, on all three OSes, and has no plaintext fallback.
- **`autoUpdater` doesn't download on its own.** You call `downloadUpdate()`, and `before-quit-for-update` is not emitted.
- **`MenuItem` properties are read-only** after construction, except `checked`.
- **`screen` is not an `EventEmitter`.**

## Out of scope by design

Bunmaska doesn't bundle Chromium, and these features are not planned. Most belong to Chromium itself. That's deliberate:

`BrowserView` / `WebContentsView` (several web views inside one window) · `desktopCapturer` · `net` / `netLog` · `webRequest` / proxy · `crashReporter` · `contentTracing` · `utilityProcess` · `TouchBar` · `inAppPurchase` · Chrome extensions · `pushNotifications` · Web Serial / WebHID / WebUSB.

For two of them, Bun already has the replacement. Instead of `net`, use `fetch` in the main process. Instead of `utilityProcess`, use `Bun.spawn` or a `Worker`.

> If a cell you need is <span class="st st-partial" role="img" aria-label="partial"></span>, <span class="st st-blocked" role="img" aria-label="engine-blocked"></span>, or listed under "Still to do", now you know, before you've ported half your app. That's the whole reason this page exists.

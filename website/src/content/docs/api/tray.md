---
title: "Tray"
description: "Add an icon, tooltip, title, and context menu to the system status bar / notification area (main process)."
order: 11
---

`Tray` adds an icon to the system status bar (macOS menu bar), notification area (Linux), or notification area / system tray (Windows). In Bunmaska the native status item is created eagerly in the constructor and reconfigured through forwarding methods, and the class extends Node's `EventEmitter` so the listener API (`on`/`once`/…) matches Electron's contract.

Platform support is uneven and honest about it:

- **macOS** - fully wired to a real `NSStatusItem`. Works un-bundled (`bun main.ts`). Icon, tooltip, title, context menu, and the `click` event all function.
- **Linux** - a `StatusNotifierItem` exported over D-Bus (KDE, the GNOME AppIndicator extension, Waybar, swaybar, etc. draw the icon). It is gated behind the `BUNMASKA_ENABLE_LINUX_TRAY=1` environment variable. With the gate off, or when no session bus is reachable, the tray is an **inert no-op** rather than a throw - so cross-platform code can construct a `Tray` safely everywhere. Even when live, `setContextMenu` is not yet shown on Linux (the `com.canonical.dbusmenu` service is deferred).
- **Windows** - wired to the notification area via `Shell_NotifyIcon`. Icon, tooltip, and the left-click `click` event all function. Caveats: `setContextMenu` is deferred (a no-op - no menu is shown), `setTitle` is a no-op (Windows tray icons have no inline text), and right-click / double-click are not surfaced.

```ts
import { app, Menu, Tray } from 'bunmaska';

let tray: Tray | null = null;

app.whenReady().then(() => {
  tray = new Tray('/path/to/iconTemplate.png');
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Item1', type: 'radio' },
    { label: 'Item2', type: 'radio' },
  ]);
  tray.setToolTip('This is my application.');
  tray.setContextMenu(contextMenu);
});
```

## Constructor

### `new Tray(image)`

- `image` string | [NativeImage](native-image.md) - a filesystem path, or a NativeImage.

Creates a status item and shows the icon immediately. `image` is a filesystem path or a `NativeImage` (a NativeImage is written to a temp PNG the native backends load by path); there is no `guid` parameter. A bad or unreadable path does not crash; the icon is simply not set. On macOS, pass a [Template Image](native-image.md) (a filename ending in `Template`) so the menu bar can invert it for light/dark mode.

```ts
import { Tray } from 'bunmaska';

const tray = new Tray('/path/to/iconTemplate.png');
```

## Methods

### `tray.setToolTip(toolTip)`

- `toolTip` string

Sets the hover text for the tray icon. No-op after `destroy()`.

```ts
tray.setToolTip('Syncing - 3 items left');
```

### `tray.setTitle(title)` _macOS_

- `title` string

Sets the text shown next to the icon in the macOS status bar. On Linux this maps to the SNI `Title` (when the live tray is enabled) and is otherwise a no-op. On Windows it is a no-op - tray icons there have no inline text. Note the simplified signature: Bunmaska does **not** accept Electron's `options.fontType` argument. No-op after `destroy()`.

```ts
tray.setTitle('42');
```

### `tray.setImage(image)`

- `image` string | [NativeImage](native-image.md) - a filesystem path, or a NativeImage.

Replaces the icon. Accepts a path string or a `NativeImage`, as the constructor does. No-op after `destroy()`.

```ts
tray.setImage('/path/to/active-iconTemplate.png');
```

### `tray.setContextMenu(menu)`

- `menu` [Menu](menu.md) | null

Attaches a context menu (shown on click) or clears it with `null`. No-op after `destroy()`.

On **macOS** this installs a real `NSMenu` and works as expected. On **Linux** this is accepted but currently a soft no-op - the menu is not shown, because the dbusmenu service is deferred. On **Windows** it is likewise a deferred no-op - the menu is accepted but not yet shown. It never throws, so the same code runs on every platform.

```ts
import { Menu } from 'bunmaska';

const menu = Menu.buildFromTemplate([
  { label: 'Open', click: () => openWindow() },
  { type: 'separator' },
  { label: 'Quit', role: 'quit' },
]);
tray.setContextMenu(menu);
```

### `tray.destroy()`

Removes the status item. Idempotent - calling it more than once is safe, and every other method becomes a no-op afterward.

```ts
tray.destroy();
```

### `tray.isDestroyed()`

Returns `boolean` - whether `destroy()` has been called.

```ts
if (!tray.isDestroyed()) {
  tray.setToolTip('still here');
}
```

## Events

### Event: 'click'

Emitted when the tray icon is activated. Unlike Electron, the listener receives **no arguments** - there is no `event`, `bounds`, or `position` payload.

Platform nuance: on **macOS**, when a context menu is set, AppKit consumes the click to present the menu, so `click` fires only when no menu is set. On **Linux**, the host's `Activate` action drives `click` (and only when the live tray is enabled). On **Windows**, a left-click on the tray icon drives `click` (right-click and double-click are not surfaced).

```ts
tray.on('click', () => {
  console.log('tray activated');
});
```

## Not in Bunmaska (yet)

Compared with Electron's `Tray`, the following are not implemented:

- **`guid` constructor parameter** - no UUID-based icon identity / position persistence.
- **`click` event payload** - Bunmaska's `click` carries no `event` / `bounds` / `position`. Electron's `bounds` and `position` data are unavailable.
- **`right-click` / `double-click` / `middle-click` events** - deferred until a real event source is wired.
- **All mouse and drag events** - `mouse-up`, `mouse-down`, `mouse-enter`, `mouse-leave`, `mouse-move`, `drop`, `drop-files`, `drop-text`, `drag-enter`, `drag-leave`, `drag-end` are not emitted.
- **`setPressedImage(image)`** _(macOS)_ - no pressed-state icon.
- **`getTitle()`** - title is write-only; there is no getter.
- **`setIgnoreDoubleClickEvents()` / `getIgnoreDoubleClickEvents()`** - not implemented.
- **`popUpContextMenu()` / `closeContextMenu()`** - no programmatic menu pop-up/dismiss.
- **`getBounds()`** - the icon's screen rectangle is not exposed.
- **`getGUID()`** - no GUID support, so nothing to return.
- **Linux and Windows context menus** - `setContextMenu` is accepted but the menu is not yet drawn on Linux (dbusmenu deferred) or Windows (deferred no-op). Only macOS shows the menu today.
- **Windows balloon / focus members** - `displayBalloon`, `removeBalloon`, `focus`, `balloon-*` events, etc. are not implemented, even though the Windows tray icon itself (via `Shell_NotifyIcon`) is now supported.

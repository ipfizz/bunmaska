---
title: "Menu"
description: "Build application and context menus in the main process - native NSMenu on macOS, GTK on Linux."
order: 7
---

Process: Main

The `Menu` module lets you build application menu bars and context (popup) menus. The menu tree is held as plain JS objects and realized into native widgets on demand - a native `NSMenu` on macOS, GTK menus on Linux, and Win32 `HMENU` on Windows. Both context menus and the application menu bar work on all three. Role items route to the responder chain on macOS; Linux wires the editing, window and `quit` roles; Windows wires the window and `quit` roles, and its editing role items are inert labels. **Accelerators are macOS-only:** Linux and Windows neither bind the key nor show it in the label yet.

Bunmaska exposes both `Menu` and a companion `MenuItem` class. You typically build menus declaratively with `Menu.buildFromTemplate(...)`, but you can also construct items by hand and `append`/`insert` them.

```ts
import { Menu, MenuItem } from 'bunmaska';
```

## Static methods

### `Menu.buildFromTemplate(template)`

`static buildFromTemplate(template: ReadonlyArray<MenuItemOptions | MenuItem>): Menu`

Builds a `Menu` from an array of plain option objects (or already-constructed `MenuItem`s). This is the usual entry point. Nested `submenu` arrays are expanded recursively, and `role` values are resolved to their default label/accelerator/native behavior.

```ts
import { Menu } from 'bunmaska';

const menu = Menu.buildFromTemplate([
  {
    label: 'File',
    submenu: [
      { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => console.log('new') }, // shortcut: macOS only
      { type: 'separator' },
      { role: 'quit' },
    ],
  },
  { role: 'editMenu' }, // macro role > expands to a full standard Edit submenu
]);

Menu.setApplicationMenu(menu);
```

### `Menu.setApplicationMenu(menu)`

`static setApplicationMenu(menu: Menu | null): void`

Sets `menu` as the application menu. On macOS this becomes the system menu bar; on Linux it is installed via the GTK realizer; on Windows it is a Win32 menu bar. Passing `null` removes the bar on all three platforms - the stored reference (`getApplicationMenu()` returns `null`) and the native side, including bars already installed on Linux.

As in Electron, a macOS app that sets no menu gets a default one once it is ready: an app menu (About, Hide, Quit), File > Close Window, and the standard Edit and Window menus, so Cmd+Q and copy/paste work out of the box. Calling `setApplicationMenu` (even with `null`) before `ready` skips it, and calling it later replaces it. Linux and Windows get no default menu bar.

```ts
import { Menu } from 'bunmaska';

const menu = Menu.buildFromTemplate([{ role: 'windowMenu' }]);
Menu.setApplicationMenu(menu);
```

### `Menu.getApplicationMenu()`

`static getApplicationMenu(): Menu | null`

Returns the `Menu` previously passed to `setApplicationMenu`, or `null` if none has been set.

```ts
import { Menu } from 'bunmaska';

const current = Menu.getApplicationMenu();
if (current) {
  console.log(`menu has ${current.items.length} top-level items`);
}
```

## Instance methods

### `menu.append(menuItem)`

`append(item: MenuItem): void`

Appends a `MenuItem` to the end of the menu.

```ts
import { Menu, MenuItem } from 'bunmaska';

const menu = new Menu();
menu.append(new MenuItem({ label: 'Open…', click: () => openFile() }));
menu.append(new MenuItem({ type: 'separator' }));
menu.append(new MenuItem({ role: 'quit' }));
```

### `menu.insert(pos, menuItem)`

`insert(pos: number, item: MenuItem): void`

Inserts `menuItem` at index `pos`. Unlike Electron, `pos` is clamped to the menu's bounds (negative values insert at the start; out-of-range values append at the end) rather than throwing.

```ts
import { Menu, MenuItem } from 'bunmaska';

const menu = Menu.buildFromTemplate([{ role: 'copy' }, { role: 'paste' }]);
menu.insert(1, new MenuItem({ type: 'separator' }));
```

### `menu.getMenuItemById(id)`

`getMenuItemById(id: string): MenuItem | null`

Returns the item whose `id` matches, searching submenus depth-first. Returns `null` if no item has that id.

```ts
import { Menu } from 'bunmaska';

const menu = Menu.buildFromTemplate([
  { label: 'View', submenu: [{ id: 'theme', label: 'Dark Mode', type: 'checkbox' }] },
]);

const item = menu.getMenuItemById('theme');
console.log(item?.checked);
```

### `menu.popup([options])`

`popup(options?: MenuPopupOptions): void`

`MenuPopupOptions` is exported from `bunmaska`. Shows the menu as a context/popup menu, anchored to a window. The target window is the `window` option if given, else the focused window, else the most-recently-created window; if none can be resolved it throws.

Differences from Electron worth knowing:

- `x` / `y` are content-relative and default to the top-left `(0, 0)` - **not** the current mouse cursor position.
- The only supported options are `window`, `x`, and `y`. There is no `frame`, `positioningItem`, `sourceType`, or `callback`.
- On macOS and Windows, `popup()` **blocks** - a nested menu-tracking loop runs until the menu is dismissed. On Linux it is non-blocking.

```ts
import { Menu } from 'bunmaska';

const ctx = Menu.buildFromTemplate([
  { label: 'Inspect', click: () => inspect() },
  { type: 'separator' },
  { role: 'copy' },
]);

// Anchor to a specific window at a content-relative point.
ctx.popup({ window: win, x: 120, y: 64 });
```

### `menu.closePopup([window])`

`closePopup(window?: BrowserWindow): void`

Closes a popup menu. With a `window` argument it targets that window; otherwise it targets the window the popup was opened on (falling back to the focused window).

Works on all three platforms. On macOS and Windows it only does something useful re-entrantly - for example, from inside an item's own `click` handler - because `popup()` itself blocks until the menu is dismissed. On Linux it pops the popover down.

```ts
import { Menu } from 'bunmaska';

const menu = Menu.buildFromTemplate([
  { label: 'Dismiss me', click: () => menu.closePopup() },
]);
menu.popup({ window: win });
```

## Properties

### `menu.items`

`readonly items: MenuItem[]`

The menu's items, in order. Each `MenuItem` may nest a `Menu` in its `submenu` property.

```ts
import { Menu } from 'bunmaska';

const menu = Menu.buildFromTemplate([{ role: 'copy' }, { role: 'paste' }]);
for (const item of menu.items) {
  console.log(item.label, item.accelerator);
}
```

## The `MenuItem` class

`new MenuItem(options: MenuItemOptions)`

Constructs a single menu item. All properties are read-only after construction. Supported `MenuItemOptions`:

- `label` (string)
- `type` (`'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio'`)
- `id` (string) - for `getMenuItemById`
- `enabled` (boolean, default `true`)
- `checked` (boolean) - renders a checkmark on `checkbox`/`radio` items; as in Electron, clicking a checkbox flips it and clicking a radio item checks it and unchecks its group (the run of radio items between separators)
- `accelerator` (string) - an accelerator like `'CmdOrCtrl+Q'` or `'Shift+F5'`: one key (a character, or a named key such as `F1`-`F24`, `Plus`, `Space`, `Tab`, `Return`, `Escape`, `Backspace`, `Insert`, `Delete`, the arrows, `Home`, `End`, `PageUp`, `PageDown`) plus modifiers. macOS only; key sequences are not parsed
- `role` (a role or macro role - see below)
- `click` (`(menuItem, window, event) => void`) - Electron's signature: `window` is the focused `BrowserWindow` (`undefined` when none is focused) and `event` is an empty object
- `submenu` (`Menu` or an array of `MenuItemOptions`)

```ts
import { MenuItem } from 'bunmaska';

const item = new MenuItem({
  id: 'wrap',
  label: 'Word Wrap',
  type: 'checkbox',
  checked: true,
  accelerator: 'Alt+Z',
  click: () => toggleWrap(),
});
```

### Roles

A `role` gives an item a default label, accelerator, and native behavior with no explicit `click`. If both a `role` and a `click` are supplied, the role wins. Role names match case-insensitively, as in Electron, and a role Bunmaska does not support becomes a plain item labelled with the role name instead of throwing.

Item-level roles: `undo`, `redo`, `cut`, `copy`, `paste`, `pasteAndMatchStyle`, `delete`, `selectAll`, `minimize`, `close`, `zoom`, `quit`, `togglefullscreen`, `about`, `hide`, `hideOthers`, `unhide`.

Macro roles (each expands into a whole standard submenu): `editMenu`, `windowMenu`.

Platform notes from the source:

- **macOS** wires every role to its standard first-responder selector (e.g. `copy:`, `terminate:`), routed up the responder chain. `quit` goes through [`app.quit()`](/docs/api/app#appquitexitcode), so `before-quit`, window `close` vetoes and `will-quit` all run.
- **Linux** dispatches editing roles (undo/redo/cut/copy/paste/delete/selectAll/pasteAndMatchStyle) as WebKitGTK editing commands and window roles (minimize/close/zoom/togglefullscreen) as GTK window ops, and `quit` calls `app.quit()`. `about`, `hide`, `hideOthers` and `unhide` render as inert labels, and no role gets a keyboard shortcut. Labels honor `&` mnemonics and keep literal underscores.
- **Windows** runs the window roles (minimize/close/zoom/togglefullscreen) on the window whose menu bar was clicked, and `quit` through `app.quit()`. The editing roles are inert labels (the WinCairo C API has no editing-command call), and no accelerator table is installed, so no shortcut is wired.

```ts
import { Menu } from 'bunmaska';

// Macro roles save you from hand-writing the standard Edit / Window menus.
const menu = Menu.buildFromTemplate([{ role: 'editMenu' }, { role: 'windowMenu' }]);
Menu.setApplicationMenu(menu);
```

## Not in Bunmaska (yet)

- **Events** - Electron's `'menu-will-show'` and `'menu-will-close'` are not emitted; `Menu` is not an `EventEmitter` here.
- **`Menu.sendActionToFirstResponder(action)`** _macOS_ - not implemented; use a `role` to get first-responder behavior instead.
- **`menu.popup` extras** - no `frame`, `positioningItem` _macOS_, `sourceType` _Windows/Linux_, or `callback` option. `x`/`y` default to the top-left, not the mouse cursor.
- **The default application menu off macOS** - Electron installs one everywhere when you set none; Bunmaska does so on macOS only (see `setApplicationMenu`).
- **`click` event details** - the `(menuItem, window, event)` signature is there, but `event` carries no `KeyboardEvent` modifier flags or `triggeredByAccelerator`.
- **Dynamic `MenuItem` mutation** - only `checked` can change after construction (a click flips it). There are no settable `enabled` / `visible` / `label` properties, no `MenuItem.sublabel`, `icon`, `toolTip`, `acceleratorWorksWhenHidden`, `registerAccelerator`, `sharingItem`, or `commandId`.
- **Deferred roles** - `appMenu`, `viewMenu`, `fileMenu`, `recentDocuments`, `shareMenu`, `services`, `startSpeaking`/`stopSpeaking`, `toggleDevTools`, `reload`/`forceReload`, `resetZoom`/`zoomIn`/`zoomOut`, and the window-control roles (`front`, `window`, `help`) are not available; they render as plain items with the role name as the label.
- **Accelerators off macOS** - Linux and Windows show neither the shortcut nor its label text.

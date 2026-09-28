---
title: "MenuItem"
description: "Construct items for native application and context menus in Bunmaska's main process - a flat, nearly immutable subset of Electron's MenuItem."
order: 8
---

A `MenuItem` is a single entry in a native menu - a normal command, a separator, a checkbox/radio toggle, or a submenu. In Bunmaska it is a plain value object: you build one from an options bag, hand it to a [`Menu`](/docs/api/menu), and the menu is realized into a native `NSMenu` (macOS), GTK menu (Linux), or Win32 `HMENU` (Windows). Unlike Electron, Bunmaska's `MenuItem` properties are **read-only**, except `checked` - you configure everything else at construction time.

## Class: MenuItem

Process: main

```ts
import { MenuItem } from 'bunmaska';
```

### `new MenuItem(options)`

`options` is an object with the following optional fields:

- `label` string - the visible text.
- `type` string - one of `'normal'`, `'separator'`, `'submenu'`, `'checkbox'`, `'radio'`. Defaults to `'submenu'` when a `submenu` is given, otherwise `'normal'`.
- `id` string - a stable id used by [`Menu.getMenuItemById`](/docs/api/menu#menugetmenuitembyidid).
- `enabled` boolean - defaults to `true`. A disabled item is greyed out and unclickable.
- `checked` boolean - defaults to `false`. Only meaningful for `'checkbox'` / `'radio'` items.
- `accelerator` string - a keyboard accelerator like `'CmdOrCtrl+Q'` (see the limitations note below).
- `role` [`MenuRole | MenuMacroRole`](#roles) - a predefined action. When set, the role supplies a default label and accelerator and provides the native behavior; if both a `role` and a `click` are given, the role wins and the `click` is ignored. Role names match case-insensitively; an unsupported role gives a plain item labelled with the role name.
- `click` `(menuItem, window, event) => void` - called when the item is activated, with Electron's arguments: the item itself, then `window` (always `undefined` for now) and an empty `event` object. For a checkbox or radio item, `checked` has already been updated when it runs.
- `submenu` [`Menu`](/docs/api/menu) `| MenuItemOptions[]` - a child menu. A plain array is auto-converted via `Menu.buildFromTemplate`.

```ts
import { MenuItem, Menu } from 'bunmaska';

const item = new MenuItem({
  label: 'Save',
  accelerator: 'CmdOrCtrl+S',
  click: () => console.log('save'),
});

const menu = Menu.buildFromTemplate([item, { type: 'separator' }, { role: 'quit' }]);
Menu.setApplicationMenu(menu);
```

A `MenuItem` is rarely constructed by hand - most code passes plain option objects straight to `Menu.buildFromTemplate`, which wraps each one in a `MenuItem` for you. The explicit constructor is there when you want to hold onto a reference.

## Properties

All properties except `checked` are **read-only**: changing an item's label or enabled state means rebuilding the menu. (Electron lets you change `menuItem.enabled`, `menuItem.label` and friends at runtime; Bunmaska does not - yet.)

### `menuItem.label`

A `string` - the item's visible label. Empty string if neither a label nor a role default was supplied.

### `menuItem.type`

A `string` - the resolved item type (`'normal'`, `'separator'`, `'submenu'`, `'checkbox'`, or `'radio'`).

### `menuItem.id`

A `string | undefined` - the item's id, if one was given.

### `menuItem.enabled`

A `boolean` - whether the item is enabled.

### `menuItem.checked`

A `boolean` - whether a `'checkbox'` / `'radio'` item renders a checkmark. Writable, and a click keeps it current the way Electron does: a checkbox flips, a radio item checks itself and unchecks the other radio items in its group (the run between separators). A value you assign yourself shows up the next time the menu is realized (`setApplicationMenu` or `popup`).

### `menuItem.accelerator`

A `string | undefined` - the item's accelerator. When a role is set and no explicit accelerator was passed, this is the role's default accelerator (e.g. `'CommandOrControl+Z'` for `undo`).

### `menuItem.role`

A [`MenuRole`](#roles) `| undefined` - the item's role. Note: for a **macro role** (`editMenu` / `windowMenu`) this is `undefined`, because the macro is expanded into a real `'submenu'` item at construction time.

### `menuItem.click`

A `((menuItem, window, event) => void) | undefined` - the click handler, if one was given and not overridden by a role.

### `menuItem.submenu`

A [`Menu`](/docs/api/menu) `| undefined` - the child menu, if present.

```ts
import { MenuItem } from 'bunmaska';

const toggle = new MenuItem({ type: 'checkbox', label: 'Word Wrap', checked: true });

console.log(toggle.type); // 'checkbox'
console.log(toggle.checked); // true
console.log(toggle.label); // 'Word Wrap'
// toggle.label = 'Wrap'; // ✗ read-only - rebuild the menu instead
```

## Roles

Bunmaska supports two kinds of role. A role gives an item a default label, accelerator, and native behavior with no explicit `click`.

**Item-level roles** (`MenuRole`) - each maps to a native action:

`undo`, `redo`, `cut`, `copy`, `paste`, `pasteAndMatchStyle`, `delete`, `selectAll`, `minimize`, `close`, `zoom`, `quit`, `togglefullscreen`, `about`, `hide`, `hideOthers`, `unhide`.

**Macro roles** (`MenuMacroRole`) - expand into a whole standard submenu:

- `editMenu` - an "Edit" submenu (undo/redo/cut/copy/paste/paste-and-match-style/delete/select-all).
- `windowMenu` - a "Window" submenu (minimize/zoom/close).

As in Electron, a `submenu` you pass alongside a macro role replaces the standard one, and a `label` renames it.

```ts
import { Menu } from 'bunmaska';

// A macro role builds an entire labelled submenu for you.
const menu = Menu.buildFromTemplate([
  { role: 'editMenu' },
  { role: 'windowMenu' },
]);
Menu.setApplicationMenu(menu);
```

### Platform behavior of roles

- _macOS_ - **all** item-level roles are wired. Each maps to a standard first-responder selector (e.g. `undo:`, `terminate:`, `toggleFullScreen:`) routed up the responder chain, so they behave exactly like the native shortcut. `quit` runs the full [`app.quit()`](/docs/api/app#appquitexitcode) sequence.
- _Linux_ - the editing roles (`undo`, `redo`, `cut`, `copy`, `paste`, `pasteAndMatchStyle`, `delete`, `selectAll`), the window roles (`minimize`, `close`, `zoom`, `togglefullscreen`) and `quit` have menu-**click** wiring. `about`, `hide`, `hideOthers` and `unhide` render as labels with no click action. No role gets a keyboard shortcut: accelerators are not bound on Linux.
- _Windows_ - `quit` runs `app.quit()`; every other role item is an inert label, and no accelerator table is installed.

## Not in Bunmaska (yet)

Bunmaska's `MenuItem` is a deliberately small, immutable subset of Electron's. Notable gaps versus Electron's reference:

- **Dynamic mutation** - every property is read-only. Electron's "This property can be dynamically changed" for `label`, `enabled`, `checked`, `visible`, `icon`, etc. does not apply; to change an item you rebuild the menu.
- **`visible`** - not implemented. There is no way to hide an individual item (`enabled: false` greys it out instead).
- **`icon`** - no per-item icons (`NativeImage` / file path).
- **`sublabel`, `toolTip`, `accessibilityLabel`** _macOS_ - none of the macOS text adornments are exposed.
- **`commandId`, `menu`, `userAccelerator`** - no back-references from an item to its sequential id, owning menu, or user-assigned accelerator.
- **`registerAccelerator`, `acceleratorWorksWhenHidden`, `sharingItem`** - not supported.
- **Click handler arguments** - the signature matches Electron, but `window` is always `undefined` and `event` is empty (no modifier keys, no `triggeredByAccelerator`).
- **`type: 'header'` / `'palette'`** (macOS 14+) - not in the supported `type` set.
- **Many roles** - only the roles listed above exist. Electron's `reload`, `forceReload`, `toggleDevTools`, `resetZoom`, `zoomIn`, `zoomOut`, `services`, `front`, `appMenu`, `viewMenu`, `fileMenu`, `shareMenu`, the spell-checker/substitutions/speech roles, the tab roles, and `recentDocuments` are **not** implemented. (`appMenu` and `viewMenu` macro roles are explicitly deferred - `appMenu` needs the app name and `viewMenu` needs reload/zoom/devtools roles that don't exist yet.)
- **Item placement options** - `before`, `after`, `beforeGroupContaining`, `afterGroupContaining` are not supported; ordering is purely the order items are appended.
- **Accelerators off macOS** - Linux and Windows neither bind an item's accelerator nor show it in the label. On macOS one key plus modifiers works, named keys (`F1`-`F24`, `Plus`, `Space`, the arrows, ...) included; key sequences are not parsed.

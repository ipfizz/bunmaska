---
title: "MenuItem"
description: "Construct items for native application and context menus in bunmaska's main process - a flat, immutable subset of Electron's MenuItem."
order: 8
---

A `MenuItem` is a single entry in a native menu - a normal command, a separator, a checkbox/radio toggle, or a submenu. In bunmaska it is a plain, immutable value object: you build one from an options bag, hand it to a [`Menu`](./menu), and the menu is realized into a native `NSMenu` (macOS) or GTK menu (Linux). Unlike Electron, bunmaska's `MenuItem` properties are **read-only** - you configure everything at construction time and you do not mutate the item afterward.

## Class: MenuItem

Process: main

```ts
import { MenuItem } from 'bunmaska';
```

### `new MenuItem(options)`

`options` is an object with the following optional fields:

- `label` string - the visible text.
- `type` string - one of `'normal'`, `'separator'`, `'submenu'`, `'checkbox'`, `'radio'`. Defaults to `'submenu'` when a `submenu` is given, otherwise `'normal'`.
- `id` string - a stable id used by [`Menu.getMenuItemById`](./menu#menugetmenuitembyidid).
- `enabled` boolean - defaults to `true`. A disabled item is greyed out and unclickable.
- `checked` boolean - defaults to `false`. Only meaningful for `'checkbox'` / `'radio'` items.
- `accelerator` string - a keyboard accelerator like `'CmdOrCtrl+Q'` (see the limitations note below).
- `role` [`MenuRole | MenuMacroRole`](#roles) - a predefined action. When set, the role supplies a default label and accelerator and provides the native behavior; if both a `role` and a `click` are given, the role wins and the `click` is ignored.
- `click` `() => void` - called when the item is activated. Note: bunmaska's click takes **no arguments** (Electron passes `(menuItem, window, event)`).
- `submenu` [`Menu`](./menu) `| MenuItemOptions[]` - a child menu. A plain array is auto-converted via `Menu.buildFromTemplate`.

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

All properties are **read-only**. There is no dynamic mutation: changing an item means rebuilding the menu. (Electron lets you flip `menuItem.checked`, `menuItem.enabled`, etc. at runtime; bunmaska does not - yet.)

### `menuItem.label`

A `string` - the item's visible label. Empty string if neither a label nor a role default was supplied.

### `menuItem.type`

A `string` - the resolved item type (`'normal'`, `'separator'`, `'submenu'`, `'checkbox'`, or `'radio'`).

### `menuItem.id`

A `string | undefined` - the item's id, if one was given.

### `menuItem.enabled`

A `boolean` - whether the item is enabled.

### `menuItem.checked`

A `boolean` - whether a `'checkbox'` / `'radio'` item renders a checkmark.

### `menuItem.accelerator`

A `string | undefined` - the item's accelerator. When a role is set and no explicit accelerator was passed, this is the role's default accelerator (e.g. `'CommandOrControl+Z'` for `undo`).

### `menuItem.role`

A [`MenuRole`](#roles) `| undefined` - the item's role. Note: for a **macro role** (`editMenu` / `windowMenu`) this is `undefined`, because the macro is expanded into a real `'submenu'` item at construction time.

### `menuItem.click`

A `(() => void) | undefined` - the click handler, if one was given and not overridden by a role.

### `menuItem.submenu`

A [`Menu`](./menu) `| undefined` - the child menu, if present.

```ts
import { MenuItem } from 'bunmaska';

const toggle = new MenuItem({ type: 'checkbox', label: 'Word Wrap', checked: true });

console.log(toggle.type); // 'checkbox'
console.log(toggle.checked); // true
console.log(toggle.label); // 'Word Wrap'
// toggle.checked = false; // ✗ read-only - rebuild the menu instead
```

## Roles

bunmaska supports two kinds of role. A role gives an item a default label, accelerator, and native behavior with no explicit `click`.

**Item-level roles** (`MenuRole`) - each maps to a native action:

`undo`, `redo`, `cut`, `copy`, `paste`, `pasteAndMatchStyle`, `delete`, `selectAll`, `minimize`, `close`, `zoom`, `quit`, `togglefullscreen`, `about`, `hide`, `hideOthers`, `unhide`.

**Macro roles** (`MenuMacroRole`) - expand into a whole standard submenu:

- `editMenu` - an "Edit" submenu (undo/redo/cut/copy/paste/paste-and-match-style/delete/select-all).
- `windowMenu` - a "Window" submenu (minimize/zoom/close).

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

- _macOS_ - **all** item-level roles are wired. Each maps to a standard first-responder selector (e.g. `undo:`, `terminate:`, `toggleFullScreen:`) routed up the responder chain, so they behave exactly like the native shortcut.
- _Linux_ - only the editing roles (`undo`, `redo`, `cut`, `copy`, `paste`, `pasteAndMatchStyle`, `delete`, `selectAll`) and the window roles (`minimize`, `close`, `zoom`, `togglefullscreen`) have menu-**click** wiring. The remaining roles (`quit`, `about`, `hide`, `hideOthers`, `unhide`) render as labels with no click action on Linux today - though their keyboard shortcuts still work natively via WebKit.

## Not in bunmaska (yet)

bunmaska's `MenuItem` is a deliberately small, immutable subset of Electron's. Notable gaps versus Electron's reference:

- **Dynamic mutation** - every property is read-only. Electron's "This property can be dynamically changed" for `label`, `enabled`, `checked`, `visible`, `icon`, etc. does not apply; to change an item you rebuild the menu.
- **`visible`** - not implemented. There is no way to hide an individual item (`enabled: false` greys it out instead).
- **`icon`** - no per-item icons (`NativeImage` / file path).
- **`sublabel`, `toolTip`, `accessibilityLabel`** _macOS_ - none of the macOS text adornments are exposed.
- **`commandId`, `menu`, `userAccelerator`** - no back-references from an item to its sequential id, owning menu, or user-assigned accelerator.
- **`registerAccelerator`, `acceleratorWorksWhenHidden`, `sharingItem`** - not supported.
- **Click handler signature** - bunmaska's `click` takes no arguments; Electron passes `(menuItem, window, event)`.
- **`type: 'header'` / `'palette'`** (macOS 14+) - not in the supported `type` set.
- **Many roles** - only the roles listed above exist. Electron's `reload`, `forceReload`, `toggleDevTools`, `resetZoom`, `zoomIn`, `zoomOut`, `services`, `front`, `appMenu`, `viewMenu`, `fileMenu`, `shareMenu`, the spell-checker/substitutions/speech roles, the tab roles, and `recentDocuments` are **not** implemented. (`appMenu` and `viewMenu` macro roles are explicitly deferred - `appMenu` needs the app name and `viewMenu` needs reload/zoom/devtools roles that don't exist yet.)
- **Item placement options** - `before`, `after`, `beforeGroupContaining`, `afterGroupContaining` are not supported; ordering is purely the order items are appended.
- **Accelerator richness** - only a single trailing key plus modifiers is parsed (e.g. `'Shift+CmdOrCtrl+Z'`). Multi-character key names (function keys, `Plus`, etc.) and key sequences are not handled.

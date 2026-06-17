---
title: "shell"
description: "Open files and URLs in their default applications, reveal items in the file manager, and play the system beep - on macOS and Linux."
order: 16
---

The `shell` module handles desktop integration: open URLs and files in their default applications, reveal a file in the OS file manager, and play the system beep. It works on both macOS and Linux, and is exposed in both the main and renderer processes.

```ts
import { shell } from 'bunmaska';

await shell.openExternal('https://github.com');
```

A note on shapes: `openExternal` and `openPath` return Promises (matching Electron), while `showItemInFolder` and `beep` are synchronous. Bunmaska does not have a sandboxed renderer, so unlike Electron there is no "won't work in a sandbox" caveat to worry about here.

## Methods

### `shell.openExternal(url)`

Returns `Promise<boolean>` - resolves to whether the URL was successfully handed off to the OS.

Opens an external URL in the desktop's default manner - `https:` in the default browser, `mailto:` in the default mail client, and so on. On macOS this goes through `NSWorkspace`; on Linux through the GTK/GIO launcher.

Note the return type difference from Electron: Electron's `openExternal` resolves to `void` and rejects on failure, whereas Bunmaska resolves to a `boolean` success flag and does not reject. Bunmaska also does not accept the second `options` argument (`activate`, `workingDirectory`, `logUsage`) - those Electron options were either macOS/Windows-specific or no-ops here.

```ts
import { shell } from 'bunmaska';

const ok = await shell.openExternal('https://bunmaska.dev');
if (!ok) {
  console.warn('No application was available to open that URL.');
}
```

### `shell.openPath(path)`

Returns `Promise<string>` - resolves with `''` on success, or an error message string on failure.

Opens a file or folder with its default application (the equivalent of a double-click in the file manager). The string-on-error / empty-on-success contract matches Electron exactly, so existing error-handling code ports over unchanged.

```ts
import { shell } from 'bunmaska';

const error = await shell.openPath('/Users/me/report.pdf');
if (error) {
  console.error(`Could not open file: ${error}`);
}
```

### `shell.showItemInFolder(path)`

Reveals a file or folder in the OS file manager, selecting it if possible (Finder on macOS, the default file manager on Linux). Synchronous, returns `void`.

```ts
import { shell } from 'bunmaska';

shell.showItemInFolder('/Users/me/Downloads/invoice.pdf');
```

### `shell.beep()`

Plays the system beep sound. Synchronous, returns `void`.

```ts
import { shell } from 'bunmaska';

shell.beep();
```

## Not in Bunmaska (yet)

Bunmaska implements four of Electron's `shell` methods. The following Electron members are not present in the source:

- **`shell.trashItem(path)`** - moving a file to the OS trash/recycle bin is not implemented on either platform. There is no fallback; if you need it today you must shell out yourself.
- **`shell.openExternal` options** - the `options` argument (`activate` _macOS_, `workingDirectory` _Windows_, `logUsage` _Windows_) is not accepted. Bunmaska's `openExternal` takes only `url`.
- **`shell.writeShortcutLink(...)` / `shell.readShortcutLink(...)`** - Windows-only shortcut (`.lnk`) APIs. Bunmaska targets macOS and Linux only, so these are intentionally out of scope rather than merely "not yet."

One behavioral difference worth repeating: `shell.openExternal` resolves to a `boolean` success flag and never rejects, whereas Electron resolves to `void` and rejects on failure.

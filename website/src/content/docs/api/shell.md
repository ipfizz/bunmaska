---
title: "shell"
description: "Open files and URLs in their default applications, reveal items in the file manager, and play the system beep - on macOS, Linux, and Windows."
order: 16
---

The `shell` module handles desktop integration: open URLs and files in their default applications, reveal a file in the OS file manager, and play the system beep. It works on macOS, Linux, and Windows (where `openExternal`/`openPath`/`showItemInFolder`/`beep` go through `ShellExecuteW` and `MessageBeep`).

Process: Main. Unlike Electron, `shell` is not available in a preload or page - it drives native APIs through `bun:ffi` - so expose the narrow piece you need with an `ipcMain.handle` and [`contextBridge`](/docs/api/context-bridge).

```ts
import { shell } from 'bunmaska';

await shell.openExternal('https://github.com');
```

A note on shapes: `openExternal` and `openPath` return Promises (matching Electron), while `showItemInFolder` and `beep` are synchronous.

## Methods

### `shell.openExternal(url)`

Returns `Promise<boolean>` - resolves to whether the URL was successfully handed off to the OS. Anything that is not an absolute URL (a bare path, a program name, a one-letter "scheme" that is really a drive letter) resolves `false` without reaching the OS, on every platform.

Opens an external URL in the desktop's default manner - `https:` in the default browser, `mailto:` in the default mail client, and so on. On macOS this goes through `NSWorkspace`; on Linux through the GTK/GIO launcher; on Windows through `ShellExecuteW`.

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

Reveals a file or folder in the OS file manager, selecting it if possible (Finder on macOS, Explorer on Windows). On Linux it opens the parent folder without selecting the item. Synchronous, returns `void`. It quietly does nothing for a path it cannot use: on macOS one with no file URL, on Windows a relative or quoted path.

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

- **`shell.trashItem(path)`** - moving a file to the OS trash/recycle bin is not implemented on any platform. There is no fallback; if you need it today you must shell out yourself.
- **`shell.openExternal` options** - the `options` argument (`activate` _macOS_, `workingDirectory` _Windows_, `logUsage` _Windows_) is not accepted. Bunmaska's `openExternal` takes only `url`.
- **`shell.writeShortcutLink(...)` / `shell.readShortcutLink(...)`** - Windows-only shortcut (`.lnk`) APIs. Even though Bunmaska now ships on Windows, these are not implemented; they remain genuinely out of scope rather than merely "not yet."

One behavioral difference worth repeating: `shell.openExternal` resolves to a `boolean` success flag and never rejects, whereas Electron resolves to `void` and rejects on failure.

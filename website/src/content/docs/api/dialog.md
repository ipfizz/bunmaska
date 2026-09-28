---
title: "dialog"
description: "Native open/save/message/error dialogs for the Bunmaska main process, backed by Cocoa NSAlert/NSOpenPanel on macOS, GtkAlertDialog/GtkFileDialog on Linux, and MessageBoxW/GetOpenFileNameW on Windows."
order: 9
---

The `dialog` module displays native system dialogs for opening and saving files and showing message and error boxes. It is a main-process module, backed by `NSAlert`/`NSOpenPanel`/`NSSavePanel` on macOS, `GtkAlertDialog`/`GtkFileDialog` on Linux, and `MessageBoxW` + `GetOpenFileNameW`/`GetSaveFileNameW` + `SHBrowseForFolderW` on Windows.

Process: Main

Unlike Electron, every Bunmaska dialog method is async and returns a Promise. There are no `*Sync` variants - the macOS backend happens to run its panels modally under the hood, but the public API is Promise-only so your code reads the same on every platform.

Each method also accepts Electron's optional leading window - `dialog.showOpenDialog(win, options)` - so ported code runs unchanged. The window is ignored, though: dialogs open as independent panels, not sheets attached to it.

```ts
import { dialog } from 'bunmaska';

const { canceled, filePaths } = await dialog.showOpenDialog({
  properties: ['openFile', 'multiSelections'],
});
console.log(canceled, filePaths);
```

## Methods

### `dialog.showOpenDialog([options])`

* `options` Object (optional)
  * `properties` string[] (optional) - Defaults to `['openFile']`. Supported values: `openFile`, `openDirectory`, `multiSelections`, and `createDirectory` (macOS). Linux ignores `openDirectory` and `multiSelections`; Windows honours `openDirectory` only when `openFile` is not also set.
  * `defaultPath` string (optional) - The directory the panel opens in (a file path opens its folder). Honoured on macOS and by the Windows file picker; the Windows folder picker and Linux ignore it.
  * `filters` [FileFilter[]](#filefilter) (optional) - File-type filters; the selectable extensions are the union of every filter's `extensions`.

Returns `Promise<Object>`:

* `canceled` boolean - `true` if no path was chosen (the dialog was dismissed).
* `filePaths` string[] - The chosen paths. Empty when canceled.

Shows a file/directory open panel. Note that `canceled` here is derived purely from whether the result is empty - there is no separate "user pressed Cancel" signal, so selecting nothing and cancelling look the same.

```ts
import { dialog } from 'bunmaska';

const result = await dialog.showOpenDialog({
  properties: ['openFile'],
  filters: [
    { name: 'Images', extensions: ['jpg', 'png', 'gif'] },
    { name: 'All Files', extensions: ['*'] },
  ],
});

if (!result.canceled) {
  console.log('You picked:', result.filePaths[0]);
}
```

### `dialog.showSaveDialog([options])`

* `options` Object (optional)
  * `defaultPath` string (optional) - The suggested file name shown in the panel. Unlike Electron, it is a **name**, not a path, on macOS and Linux; Windows also accepts a full path.
  * `filters` [FileFilter[]](#filefilter) (optional) - File-type filters; the allowed extensions are the union of every filter's `extensions`.

Returns `Promise<Object>`:

* `canceled` boolean - `true` if the dialog was dismissed without a path.
* `filePath` string - The chosen path. Empty string when canceled.

Shows a save panel and resolves with the destination path the user picked.

```ts
import { dialog } from 'bunmaska';

const { canceled, filePath } = await dialog.showSaveDialog({
  defaultPath: 'untitled.txt',
  filters: [{ name: 'Text', extensions: ['txt'] }],
});

if (!canceled) {
  await Bun.write(filePath, 'hello from bunmaska');
}
```

### `dialog.showMessageBox(options)`

* `options` Object
  * `message` string - Content of the message box.
  * `detail` string (optional) - Extra information shown below the message.
  * `buttons` string[] (optional) - Button labels. Defaults to `['OK']`. The first entry is the default button. _Windows caveat:_ custom labels are approximated to the nearest native `MessageBoxW` button set (OK, OK/Cancel, or Yes/No/Cancel) rather than rendered verbatim.
  * `type` string (optional) - One of `none`, `info`, `error`, `question`, `warning`. Styles the `NSAlert` icon on macOS. _Linux_ has no severity concept on `GtkAlertDialog`, so `type` is a no-op there.

Returns `Promise<Object>`:

* `response` number - The index of the clicked button.

Shows a message box and resolves with the index of the button the user clicked. On Linux and Windows, dismissing the box without a click resolves to Electron's default `cancelId`: the first button labelled "Cancel" or "No" (any case), else `0`.

```ts
import { dialog } from 'bunmaska';

const { response } = await dialog.showMessageBox({
  type: 'question',
  message: 'Discard unsaved changes?',
  detail: 'This cannot be undone.',
  buttons: ['Cancel', 'Discard'],
});

if (response === 1) {
  // user clicked "Discard"
}
```

### `dialog.showErrorBox(title, content)`

* `title` string - The title / headline of the error.
* `content` string - The body text of the error.

Returns `void`.

Displays an error-styled alert. Under the hood this is a fire-and-forget call into the message-box backend with `type: 'error'` - unlike Electron's truly synchronous `showErrorBox`, Bunmaska does not block, and on _Linux_ the dialog is shown asynchronously and the call returns immediately. There is no special pre-`ready` / stderr fallback: it always goes through the same native backend, and if that fails the failure is logged rather than thrown.

```ts
import { dialog } from 'bunmaska';

dialog.showErrorBox('Export failed', 'Could not write to the selected folder.');
```

## Structures

### FileFilter

* `name` string - The label shown for this filter group.
* `extensions` string[] - Allowed extensions, without dots or wildcards (e.g. `'png'`, not `'.png'` or `'*.png'`). Use `'*'` to mean "any file"; it is dropped from the effective extension set rather than expanded.

Bunmaska flattens all of a dialog's filters into a single deduped extension list and passes that to the native panel - it does not render a per-group filter dropdown the way Electron does. The `'*'` wildcard entries are stripped, so a filter list that contains a `'*'` group effectively allows everything.

## Not in Bunmaska (yet)

The following Electron `dialog` members are not implemented in the Bunmaska source:

- **Synchronous variants** - `showOpenDialogSync`, `showSaveDialogSync`, and `showMessageBoxSync` do not exist. Use the Promise-returning methods above.
- **`showCertificateTrustDialog`** - no certificate trust/import dialog.
- **A working `window` (parent) argument** - every method accepts the leading `BrowserWindow`, but ignores it, so dialogs are not attached as macOS sheets or made window-modal; they appear as independent panels. The whole "Sheets" and `setSheetOffset` story does not apply.
- **macOS security-scoped bookmarks** - no `securityScopedBookmarks` option and no `bookmarks`/`bookmark` fields in the results.
- **Most option fields** - `title`, `buttonLabel`, `message`/`detail` on file dialogs, `nameFieldLabel`, `showsTagField`, `defaultId`, `cancelId`, `signal` (AbortSignal), `icon`, `textWidth`, `checkboxLabel`/`checkboxChecked`, `noLink`, and `normalizeAccessKeys` are all unsupported. `showMessageBox` resolves with only `{ response }` - there is no `checkboxChecked` in the result.
- **Open-dialog `properties` beyond the basics** - only `openFile`, `openDirectory`, `multiSelections`, and `createDirectory` (macOS) are honored (and Linux picks a single file whatever you pass). `showHiddenFiles`, `promptToCreate`, `noResolveAliases`, `treatPackageAsDirectory`, and `dontAddToRecent` are not.
- **Per-filter file-type dropdown** - filters are merged into one flat extension list rather than presented as selectable groups.

---
title: "clipboard"
description: "Honest bunmaska API reference for the clipboard module: async reads, sync writes, text/HTML/image only, with a clear list of unimplemented Electron members."
order: 10
---

Perform copy and paste operations on the system clipboard. In bunmaska the `clipboard` module is a process-wide singleton (not tied to any window) available in both the main and renderer processes, backed by Cocoa (`NSPasteboard`) on macOS, GTK 4 / GDK on Linux, and the Win32 clipboard (`CF_*` formats with GDI+) on Windows.

One deliberate difference from Electron: all **read** methods are asynchronous and return a `Promise`. GDK 4's clipboard read is async-only, so bunmaska adopts the same async contract on macOS for a uniform cross-platform API. Writes (and `clear`) stay synchronous everywhere. On platforms without a backend, methods throw `UnsupportedPlatformError` rather than silently doing nothing.

## Methods

### `clipboard.readText()`

`readText(): Promise<string>`

Reads the clipboard's plain-text contents, resolving to `''` if the clipboard holds no text. Asynchronous on every platform (unlike Electron, which returns a string synchronously).

```ts
import { clipboard } from 'bunmaska';

clipboard.writeText('hello i am a bit of text!');

const text = await clipboard.readText();
console.log(text);
// hello i am a bit of text!
```

### `clipboard.writeText(text)`

`writeText(text: string): void`

Replaces the clipboard's contents with `text` as plain text. Synchronous.

```ts
import { clipboard } from 'bunmaska';

clipboard.writeText('hello i am a bit of text!');
```

### `clipboard.readHTML()`

`readHTML(): Promise<string>`

Reads the clipboard's HTML markup, resolving to `''` if the clipboard holds no HTML. Asynchronous on every platform.

```ts
import { clipboard } from 'bunmaska';

clipboard.writeHTML('<b>Hi</b>');

const html = await clipboard.readHTML();
console.log(html);
// <b>Hi</b>
```

### `clipboard.writeHTML(markup)`

`writeHTML(markup: string): void`

Replaces the clipboard's contents with `markup` as HTML. Synchronous.

```ts
import { clipboard } from 'bunmaska';

clipboard.writeHTML('<b>Hi</b>');
```

### `clipboard.readImage()`

`readImage(): Promise<NativeImage>`

Reads the image on the clipboard, resolving to a [`NativeImage`](native-image.md). If the clipboard holds no image, resolves to an empty `NativeImage` (`nativeImage.createEmpty()`). Asynchronous on every platform.

```ts
import { clipboard } from 'bunmaska';

const image = await clipboard.readImage();
if (!image.isEmpty()) {
  console.log(image.getSize());
}
```

### `clipboard.writeImage(image)`

`writeImage(image: NativeImage): void`

Writes `image` to the clipboard. The image is encoded as PNG before being placed on the pasteboard (bunmaska calls `image.toPNG()` internally). Synchronous.

```ts
import { clipboard, nativeImage } from 'bunmaska';

const image = nativeImage.createFromPath('/path/to/icon.png');
clipboard.writeImage(image);
```

### `clipboard.availableFormats()`

`availableFormats(): string[]`

Returns the format names (MIME types) currently advertised by the clipboard. Synchronous.

```ts
import { clipboard } from 'bunmaska';

clipboard.writeText('test');
console.log(clipboard.availableFormats());
// [ 'text/plain', ... ]
```

Note: bunmaska reports MIME-style format names (e.g. `text/plain`, `text/html`, `image/png`), matching Electron's Linux output rather than the macOS `public.*` UTI naming. (The Linux backend currently leaks raw GDK format strings here - a known drift being normalized in alpha.6.)

### `clipboard.clear()`

`clear(): void`

Clears the clipboard contents. Synchronous, and unlike Electron takes no `type` argument (see below).

```ts
import { clipboard } from 'bunmaska';

clipboard.clear();
```

## Not in bunmaska (yet)

Comparing against Electron's `clipboard`, the following members are **not** implemented:

- **The Linux `selection` clipboard / `type` parameter** - no method accepts Electron's optional `type` ('clipboard' | 'selection') argument. bunmaska only touches the standard system clipboard; the Linux PRIMARY selection is not exposed.
- **`readRTF` / `writeRTF`** - no rich-text format support.
- **`readBookmark` / `writeBookmark`** - no bookmark (title + URL) pasteboard support (macOS/Windows in Electron).
- **`readFindText` / `writeFindText`** - no macOS find-pasteboard support.
- **`has(format)`** - no per-format availability check; use `availableFormats()` and test membership yourself.
- **`read(format)` / `readBuffer(format)` / `writeBuffer(format, buffer)`** - no arbitrary-format raw read/write. bunmaska handles only text, HTML, and PNG images through the typed methods above.
- **`write(data)`** - no single combined write of `{ text, html, image, rtf, bookmark }` in one call; write each format with its dedicated method.
- **Synchronous reads** - intentionally not offered. `readText`, `readHTML`, and `readImage` are `Promise`-returning on every platform (the Linux backend is fundamentally async); there is no sync variant. Plan to `await`.

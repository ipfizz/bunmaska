---
title: "nativeImage"
description: "Load, query, encode, resize, and crop tray/dock/window icons from PNG or JPEG, backed by Cocoa on macOS, GdkPixbuf on Linux, and GDI+ on Windows."
order: 13
---

The `nativeImage` module loads, queries, and encodes system images - the icons you hand to a `Tray`, a window, or a `Menu`. It is a deliberate subset of Electron's module: decoding and pixel work happen behind a per-platform native backend (Cocoa `NSBitmapImageRep` on macOS, GdkPixbuf on Linux, GDI+ on Windows), while the `NativeImage` class itself is plain TypeScript.

A bad path or undecodable bytes never throw - they yield an _empty_ image (`isEmpty()` is `true`, size `0×0`), matching Electron's "empty and transparent image" behavior.

> Process: Main. The module is exported from `bunmaska` / `bunmaska/main`, not `bunmaska/renderer`. As in Electron, if you need an image in a renderer, build it in your preload/main and pass it across - there is no renderer-side `nativeImage` factory.

## Static methods

These live on the `nativeImage` object and each return a `NativeImage`.

### `nativeImage.createFromPath(path)`

`createFromPath(path: string): NativeImage`

Loads an image from a filesystem path (PNG or JPEG). An unreadable path or non-image file returns an empty image rather than throwing.

```ts
import { nativeImage } from 'bunmaska';

const icon = nativeImage.createFromPath('/Users/somebody/images/icon.png');
console.log(icon.isEmpty(), icon.getSize()); // false { width: 32, height: 32 }
```

### `nativeImage.createFromBuffer(buffer)`

`createFromBuffer(buffer: Uint8Array): NativeImage`

Decodes in-memory PNG or JPEG bytes. Undecodable bytes return an empty image.

```ts
import { readFileSync } from 'node:fs';
import { nativeImage } from 'bunmaska';

const bytes = readFileSync('/Users/somebody/images/icon.png');
const image = nativeImage.createFromBuffer(bytes);
```

Note: unlike Electron, this takes no `options` argument - there is no raw-bitmap path here (see _Not in bunmaska_). It always decodes encoded image bytes.

### `nativeImage.createFromDataURL(dataURL)`

`createFromDataURL(dataURL: string): NativeImage`

Decodes a `data:` URL. Both base64 (`;base64,`) and URL-encoded payloads are handled. A string that is not a `data:` URL returns an empty image.

```ts
import { nativeImage } from 'bunmaska';

const image = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB...',
);
```

### `nativeImage.createEmpty()`

`createEmpty(): NativeImage`

Creates an empty, transparent image with no native decode. Handy as a placeholder.

```ts
import { nativeImage } from 'bunmaska';

const blank = nativeImage.createEmpty();
console.log(blank.isEmpty()); // true
```

## Instance methods

Available on any `NativeImage` returned by the factory. The class is never constructed directly.

### `image.getSize()`

`getSize(): { width: number; height: number }`

Returns the image's pixel dimensions, or `{ width: 0, height: 0 }` when empty.

> Implementation aside: `bun:ffi` can't return a struct by value, so Electron's `NSImage.size` (an `NSSize`) is unreadable across the boundary. Each backend instead reports width/height via scalar getters at decode time. The practical upshot for you: `getSize()` takes no `scaleFactor` argument.

```ts
import { nativeImage } from 'bunmaska';

const { width, height } = nativeImage.createFromPath('./icon.png').getSize();
```

### `image.isEmpty()`

`isEmpty(): boolean`

Whether the image has no usable contents (bad path, undecodable bytes, or created empty).

```ts
import { nativeImage } from 'bunmaska';

if (nativeImage.createFromPath('./missing.png').isEmpty()) {
  console.warn('icon failed to load; falling back to a default');
}
```

### `image.getAspectRatio()`

`getAspectRatio(): number`

The image's width-to-height ratio, or `0` when empty / zero-height.

```ts
import { nativeImage } from 'bunmaska';

const ratio = nativeImage.createFromPath('./banner.png').getAspectRatio(); // e.g. 1.777...
```

Note: unlike Electron this takes no `scaleFactor` argument (bunmaska images carry a single representation).

### `image.toPNG()`

`toPNG(): Uint8Array`

Encodes the image to PNG bytes. An empty image returns a zero-length buffer.

```ts
import { writeFileSync } from 'node:fs';
import { nativeImage } from 'bunmaska';

const png = nativeImage.createFromPath('./icon.jpg').toPNG();
writeFileSync('./icon.png', png);
```

Note: takes no `options` - there is no `scaleFactor` parameter.

### `image.toJPEG(quality)`

`toJPEG(quality?: number): Uint8Array`

Encodes the image to JPEG bytes. `quality` is `0`-100 and defaults to `92`. An empty image returns a zero-length buffer.

```ts
import { writeFileSync } from 'node:fs';
import { nativeImage } from 'bunmaska';

const jpeg = nativeImage.createFromPath('./photo.png').toJPEG(80);
writeFileSync('./photo.jpg', jpeg);
```

> Platform note: `quality` is honored on _macOS_ (via `NSImageCompressionFactor`). On _Linux_ (GdkPixbuf) and _Windows_ (GDI+), the image is saved with the encoder's default quality and the `quality` argument is ignored. The default value differs from Electron's API too: Electron requires `quality`; bunmaska defaults it to `92`.

### `image.toDataURL()`

`toDataURL(): string`

Returns the image as a `data:image/png;base64,...` URL (PNG-encoded). An empty image produces a URL with an empty payload.

```ts
import { nativeImage } from 'bunmaska';

const url = nativeImage.createFromPath('./icon.png').toDataURL();
// 'data:image/png;base64,iVBORw0KGgo...'
```

Note: always PNG; takes no `options` / `scaleFactor`.

### `image.resize(options)`

`resize(options: { width?: number; height?: number; quality?: 'good' | 'better' | 'best' }): NativeImage`

Returns a new image resized to the given dimensions. Omitting one dimension preserves the aspect ratio; omitting both returns an unchanged-size copy. Resizing an empty image yields an empty image.

```ts
import { nativeImage } from 'bunmaska';

const big = nativeImage.createFromPath('./icon.png');
const thumb = big.resize({ width: 64 }); // height derived to keep aspect ratio
const square = big.resize({ width: 32, height: 32 });
```

> `quality` is accepted for Electron source-compatibility but is best-effort: the macOS backend redraws via a CoreGraphics offscreen bitmap and Linux uses GdkPixbuf bilinear scaling, so the `'good' | 'better' | 'best'` hint does not currently select distinct algorithms.

### `image.crop(rect)`

`crop(rect: { x: number; y: number; width: number; height: number }): NativeImage`

Returns a new image containing the sub-rectangle (pixels, top-left origin). A rect that is empty or entirely outside the image yields an empty image; a partially-overflowing rect is clamped to bounds.

```ts
import { nativeImage } from 'bunmaska';

const full = nativeImage.createFromPath('./sprite.png');
const tile = full.crop({ x: 0, y: 0, width: 16, height: 16 });
```

### `image.setTemplateImage(option)`

`setTemplateImage(option: boolean): void`

Marks (or unmarks) the image as a template - a monochrome icon the OS recolors for light/dark UI. This is plain JS metadata on the image, mirroring Electron's own model: the macOS `NSImage setTemplate:` flag is applied when the image is _realized_ for a `Tray` or menu, not on the decoded representation here.

```ts
import { nativeImage } from 'bunmaska';

const trayIcon = nativeImage.createFromPath('./iconTemplate.png');
trayIcon.setTemplateImage(true);
```

> Practically meaningful on _macOS_ menu-bar/tray rendering; on Linux it is carried but has no recoloring effect.

### `image.isTemplateImage()`

`isTemplateImage(): boolean`

Whether the image is currently marked as a template image.

```ts
import { nativeImage } from 'bunmaska';

const img = nativeImage.createFromPath('./iconTemplate.png');
img.setTemplateImage(true);
console.log(img.isTemplateImage()); // true
```

## Events

The `nativeImage` module and `NativeImage` class emit no events.

## Properties

`NativeImage` exposes no public data properties. (Electron's `isMacTemplateImage` property is replaced here by the `setTemplateImage()` / `isTemplateImage()` method pair.)

## Not in bunmaska (yet)

Comparing against Electron's `nativeImage`, the following are not implemented. Most reflect the single-representation, scalar-metadata design and the macOS-specific AppKit surface.

- `createFromBitmap(buffer, options)` - no raw ARGB/bitmap ingestion path; only encoded PNG/JPEG bytes decode.
- `createThumbnailFromPath(path, size)` - no OS thumbnail service is wired (Electron ships it _macOS_/_Windows_ only anyway).
- `createFromNamedImage(imageName, options)` - _macOS_ `NSImage`/SF Symbols by name, plus `hslShift`/`pointSize`/`weight`/`scale`, are not exposed.
- `createMenuSymbol(imageName)` - _macOS_ SF Symbol menu icons are not implemented.
- `getBitmap(options)` / `toBitmap(options)` - no raw pixel-buffer readback (no struct/buffer round-trip across the FFI for this).
- `getNativeHandle()` - the native handle is held internally but not surfaced as a `Buffer` pointer.
- `getScaleFactors()` and the `@2x`/`@3x` multi-representation, high-DPI model - images carry a single representation; explicitly deferred in the source.
- `addRepresentation(options)` - follows from the above; there is no representation list to append to.
- `scaleFactor` options on `getSize`, `getAspectRatio`, `toPNG`, `toBitmap`, `toDataURL` - omitted along with multi-rep support.
- `colorSpace` option on bitmap output - no bitmap output exists to color-manage.
- The `isMacTemplateImage` property - covered instead by `setTemplateImage()` / `isTemplateImage()`.
- Windows `ICO` loading - Windows is supported via GDI+ (path/PNG/JPEG decode, `toPNG`/`toJPEG`, resize, crop), but `.ico` files are not special-cased; pass PNG or JPEG.

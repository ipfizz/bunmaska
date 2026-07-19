---
title: "screen"
description: "Enumerate displays and read screen geometry in the bunmaska main process - the drop-in equivalent of Electron's screen module, minus the DIP conversions and change events."
order: 18
---

Retrieve information about connected displays and their geometry. `screen` is the bunmaska equivalent of Electron's `screen` module: a main-process singleton that enumerates displays and exposes their bounds, work area, scale factor, rotation, and a few other fields.

Process: Main

Unlike Electron, bunmaska's `screen` is **not** an `EventEmitter` and emits no events - it is a plain object with methods. Display geometry comes from CoreGraphics scalar getters on macOS, GTK4's `GdkMonitor` model on Linux, and `EnumDisplayMonitors` + `GetMonitorInfoW` + `GetDpiForMonitor` on Windows (displays, bounds, work area, and scale factor).

```ts
import { app, BrowserWindow, screen } from 'bunmaska';

app.whenReady().then(() => {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.workAreaSize;
  const win = new BrowserWindow({ width, height });
  win.loadURL('https://example.com');
});
```

> Coordinates are top-left-origin screen points (matching Electron). Both backends report top-left-origin rects, so no Y-flip is applied.

## Methods

### `screen.getAllDisplays()`

Returns `Display[]` - every display currently connected. On a real host this always contains at least one entry.

```ts
import { screen } from 'bunmaska';

for (const display of screen.getAllDisplays()) {
  console.log(display.id, display.bounds, display.scaleFactor);
}
```

### `screen.getPrimaryDisplay()`

Returns `Display` - the OS's primary display. On macOS this is the origin-anchored main display (`CGDisplayIsMain`); on Linux, GTK4 removed the primary-monitor concept, so the first enumerated monitor (index 0) is treated as primary.

```ts
import { screen } from 'bunmaska';

const primary = screen.getPrimaryDisplay();
console.log(`Primary is ${primary.size.width}x${primary.size.height} @ ${primary.scaleFactor}x`);
```

### `screen.getDisplayNearestPoint(point)`

* `point` `Point`

Returns `Display` - the display whose bounds contain `point`, or the geometrically nearest one (by squared distance to the rect's nearest edge) if no display contains it.

```ts
import { screen } from 'bunmaska';

const display = screen.getDisplayNearestPoint({ x: 1920, y: 200 });
console.log('nearest display id:', display.id);
```

> _macOS caveat:_ CoreGraphics has no scalar getter for a secondary display's global origin, so secondary displays report `bounds.x`/`bounds.y` as `(0,0)`. This makes nearest-point resolution across multiple monitors approximate on macOS until struct-return support lands. On Linux, `GdkMonitor` geometry is a true OUT-param struct, so multi-monitor origins (and therefore this method) are exact.

### `screen.getDisplayMatching(rect)`

* `rect` `Rectangle`

Returns `Display` - the display with the largest area of overlap with `rect`. Ties and zero-overlap rects fall back to the display nearest the rect's center.

```ts
import { screen } from 'bunmaska';

const display = screen.getDisplayMatching({ x: 100, y: 100, width: 800, height: 600 });
console.log('window will live on display:', display.id);
```

### `screen.getCursorScreenPoint()`

Returns `Point` - the current cursor position in top-left screen coordinates.

> **Stub everywhere (v1).** This currently returns `{ x: 0, y: 0 }` on macOS, Linux and Windows. On macOS, `NSEvent.mouseLocation` returns an `NSPoint` struct, which hits the same bun:ffi struct-return wall that blocks display origins (and would also need a bottom-left-origin flip). On Linux, the GTK4 pointer position requires a surface + seat + device that this read-only enumeration backend does not hold. Don't rely on this value yet.

```ts
import { screen } from 'bunmaska';

const point = screen.getCursorScreenPoint(); // currently always { x: 0, y: 0 }
```

## Structures

### `Display`

A connected display. Mirrors a subset of Electron's `Display`:

* `id` number - `CGDirectDisplayID` on macOS; the list index on Linux (`GdkMonitor` has no stable numeric id).
* `bounds` `Rectangle` - display position and size in top-left screen coordinates.
* `workArea` `Rectangle` - the usable area excluding OS chrome. **On both platforms in v1, `workArea` equals `bounds`** - the macOS menu-bar/dock inset needs `NSScreen.visibleFrame` (a struct return), and GTK4's `GdkMonitor` has no work-area/strut API.
* `size` `Size` - `{ width, height }` derived from `bounds`.
* `workAreaSize` `Size` - `{ width, height }` derived from `workArea` (so currently identical to `size`).
* `scaleFactor` number - device-pixel ratio (≥ 1).
* `rotation` number - degrees clockwise. _macOS_ only reports real values (`CGDisplayRotation`); on Linux and Windows this is always `0`.
* `internal` boolean - true for a built-in panel. _macOS_ only (`CGDisplayIsBuiltin`); on Linux and Windows this is always `false`.

### `Point`

* `x` number
* `y` number

### `Size`

* `width` number
* `height` number

### `Rectangle`

* `x` number
* `y` number
* `width` number
* `height` number

## Testing helper

### `setScreenBackendForTesting(fake)`

Exported but test-only: injects a fake `ScreenBackend` so the pure geometry logic (`getDisplayNearestPoint`, `getDisplayMatching`, etc.) can be exercised on any host without a real display. Not part of the Electron surface; don't use it in app code.

## Not in bunmaska (yet)

Compared to Electron's `screen`, these are missing:

* **Events** - `display-added`, `display-removed`, and `display-metrics-changed` are not implemented. bunmaska's `screen` is a plain object, not an `EventEmitter`, so there is no hot-plug or metrics-change notification. Re-call `getAllDisplays()` if you need fresh data.
* **DIP/physical conversion methods** - `screenToDipPoint`, `dipToScreenPoint`, `screenToDipRect`, and `dipToScreenRect` are absent. (These are Windows-only or Windows/Linux-only in Electron; bunmaska does not implement them on any backend, including Windows.)
* **Working `getCursorScreenPoint()`** - present but stubbed to `{0,0}` everywhere (see above).
* **Real `workArea`** - reported but always equal to `bounds`; the OS-chrome inset is not subtracted yet.
* **Accurate macOS multi-monitor origins** - secondary-display `bounds.x`/`bounds.y` are `(0,0)` on macOS pending bun:ffi struct-return support. Linux origins are exact.
* **Extra `Display` fields** - Electron's `Display` also carries `label`, `colorSpace`, `colorDepth`, `depthPerComponent`, `displayFrequency`, `monochrome`, `accelerometerSupport`, `touchSupport`, and `maximumCursorSize`. bunmaska's `Display` exposes only the geometry-and-essentials subset listed above. Additionally, `rotation` is macOS-only and `internal` is macOS-only.

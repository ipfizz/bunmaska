---
title: "nativeTheme"
description: "Read and respond to the OS dark/light appearance, with a themeSource override. Main process only; macOS and Linux."
order: 14
---

Read and respond to changes in the operating system's native color theme. Bunmaska's `nativeTheme` is a main-process singleton that reports whether a dark appearance should be used, lets you force light/dark via `themeSource`, and emits `updated` when the OS appearance flips underneath your app. It reads the real OS setting on both platforms - macOS `AppleInterfaceStyle` and Linux `GtkSettings` (`gtk-application-prefer-dark-theme`).

Process: Main. There is no renderer-side `nativeTheme`; query it from main and forward what you need over IPC (the `prefers-color-scheme` CSS media query works in the page regardless).

```ts
import { nativeTheme } from 'bunmaska';
```

## Events

### Event: 'updated'

Emitted when the underlying native theme changes. In practice this means the value of `shouldUseDarkColors` may have changed - either because the OS appearance flipped, or because you assigned a new `themeSource`. Read the properties you care about to find out what changed.

Note that the OS-driven half of this event only fires once startup has wired the appearance observer (the Bunmaska bootstrap does this for you). The assignment-driven half (`themeSource = ...`) always emits.

```ts
import { nativeTheme } from 'bunmaska';

nativeTheme.on('updated', () => {
  console.log('dark mode is now', nativeTheme.shouldUseDarkColors);
});
```

## Properties

### `nativeTheme.shouldUseDarkColors` _Readonly_

A `boolean` for whether a dark-style UI should be used. This honors `themeSource`: it returns `true` when `themeSource` is `'dark'`, `false` when `'light'`, and otherwise reflects the live OS appearance. To change it, set `themeSource` rather than trying to assign here.

```ts
import { nativeTheme, BrowserWindow } from 'bunmaska';

const win = new BrowserWindow();
win.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors);
```

### `nativeTheme.themeSource`

A `string` property - one of `'system'`, `'light'`, or `'dark'` - that overrides the appearance Bunmaska would otherwise pick from the OS. Defaults to `'system'`.

- `'system'` removes the override and follows the OS appearance.
- `'dark'` makes `shouldUseDarkColors` return `true` and the `prefers-color-scheme` CSS query match `dark`.
- `'light'` makes `shouldUseDarkColors` return `false` and the CSS query match `light`.

Assigning this property always emits the `updated` event. On macOS it also applies an app-wide `NSAppearance` (`NSAppearanceNameDarkAqua` / `NSAppearanceNameAqua`), so native chrome and web views re-theme to match. _On Linux the override changes what `shouldUseDarkColors` and the `updated` event report, but it does not currently push an app-wide appearance to the toolkit_ - so wire your renderer's theme off `shouldUseDarkColors` (as you should anyway) rather than assuming GTK widgets will follow.

The intended state machine is the classic three-way dark-mode toggle:

```ts
import { nativeTheme, ipcMain } from 'bunmaska';

ipcMain.handle('dark-mode:set', (_event, choice: 'system' | 'light' | 'dark') => {
  nativeTheme.themeSource = choice;
  return nativeTheme.shouldUseDarkColors;
});
```

### `nativeTheme.prefersReducedTransparency` _Readonly_

A `boolean` indicating whether the user has asked the OS to reduce transparency. _macOS_ only: it maps to the Accessibility "Reduce transparency" setting (`NSWorkspace.accessibilityDisplayShouldReduceTransparency`). On Linux it always returns `false`, since GTK has no equivalent system setting.

```ts
import { nativeTheme } from 'bunmaska';

if (nativeTheme.prefersReducedTransparency) {
  // skip the blurry vibrancy and use a solid background
}
```

## Not in Bunmaska (yet)

Bunmaska covers the everyday dark-mode surface (`shouldUseDarkColors`, `themeSource`, `prefersReducedTransparency`, and the `updated` event) but omits several of Electron's accessibility/contrast readouts:

- `shouldUseHighContrastColors` - high-contrast detection is not implemented on either platform.
- `shouldUseDarkColorsForSystemIntegratedUI` - no separate system-vs-app dark distinction is exposed.
- `shouldUseInvertedColorScheme` - inverted-color-scheme detection is not wired.
- `shouldDifferentiateWithoutColor` - the macOS "differentiate without color" accessibility flag is not read.
- `inForcedColorsMode` - Windows-only in Electron, and Bunmaska has no Windows support, so it does not exist here.

These all return readonly booleans in Electron; if your app reads them, treat them as absent on Bunmaska and fall back to `shouldUseDarkColors` plus `prefersReducedTransparency`.

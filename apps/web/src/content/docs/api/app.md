---
title: "app"
description: "The application lifecycle controller in Bunmaska - a drop-in equivalent of Electron's app for managing readiness, quitting, paths, locale, the single-instance lock, and macOS desktop integration."
order: 1
---

Process: Main

The `app` module controls your application's event lifecycle. In Bunmaska it is the drop-in equivalent of Electron's `app`: it tracks readiness, coordinates a clean quit, resolves the standard special directories, reports name/version/locale, manages the single-instance lock, and exposes the macOS desktop bits (dock, hide/show, about panel, badge). It extends Node's `EventEmitter`, so the full listener API (`on` / `once` / `addListener` / `removeListener` / `emit` / …) matches Electron's contract.

`app` is a singleton - import it; do not construct it.

```ts
import { app } from 'bunmaska'

app.whenReady().then(() => {
  // create windows here
})
```

## Methods

### `app.whenReady()`

Returns `Promise<void>` - resolves once the app is ready to create windows. The first call triggers the native bootstrap; if the app is already ready it resolves immediately.

```ts
import { app, BrowserWindow } from 'bunmaska'

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 800, height: 600 })
  win.loadURL('https://bun.sh')
})
```

### `app.isReady()`

There is no `isReady()` method - use the `isReady` property below. (Noted here only because Electron developers reach for it out of habit.)

### `app.quit([exitCode])`

* `exitCode` Integer (optional) - defaults to `0`.

Begins shutting the app down. Emits the cancelable `before-quit` event, then `will-quit`; if a listener calls `preventDefault()` on either, the quit is aborted. If neither vetoes, emits `quit` with the exit code and exits the process. Idempotent - a second call while already quitting is ignored.

Note: unlike Electron, Bunmaska's `quit()` does not run web-page `beforeunload`/`unload` handlers as a veto path; the veto comes from your main-process `before-quit` / `will-quit` listeners.

```ts
import { app } from 'bunmaska'

app.on('before-quit', (event) => {
  if (hasUnsavedWork()) {
    event.preventDefault() // keep the app alive
  }
})

app.quit()
```

### `app.exit([exitCode])`

* `exitCode` Integer (optional) - defaults to `0`.

Exits immediately with `exitCode`, skipping the `before-quit` / `will-quit` / `quit` events entirely.

```ts
import { app } from 'bunmaska'

app.exit(1)
```

### `app.relaunch([options])`

* `options` Object (optional)
  * `args` string[] (optional) - defaults to the current process's argv (minus the executable).
  * `execPath` string (optional) - defaults to the current executable.

Relaunches the app when the current instance exits. As in Electron, this does not quit on its own - call `app.quit()` or `app.exit()` afterwards to actually restart.

```ts
import { app } from 'bunmaska'

app.relaunch({ args: process.argv.slice(1).concat(['--relaunch']) })
app.exit(0)
```

### `app.getAppPath()`

Returns `string` - the application root directory (the nearest `package.json`, or the current working directory).

```ts
import { app } from 'bunmaska'

console.log(app.getAppPath())
```

### `app.getPath(name)`

* `name` string - one of: `home`, `appData`, `userData`, `sessionData`, `temp`, `exe`, `module`, `desktop`, `documents`, `downloads`, `music`, `pictures`, `videos`, `logs`, `crashDumps`.

Returns `string` - a path to the special directory associated with `name`, honoring any override set via `setPath`.

Bunmaska supports the common subset of Electron's names. It does **not** support `recent` (Windows-only in Electron anyway) or `assets`.

```ts
import { app } from 'bunmaska'
import { join } from 'node:path'

const dbFile = join(app.getPath('userData'), 'app.db')
```

### `app.setPath(name, path)`

* `name` string - one of the names accepted by `getPath`.
* `path` string

Overrides the path returned by `getPath` for a given name. Unlike Electron, Bunmaska does not validate that the directory exists - create it yourself if needed.

```ts
import { app } from 'bunmaska'

app.setPath('userData', '/tmp/my-app-data')
```

### `app.setAppLogsPath([path])`

* `path` string (optional) - a custom absolute path for your logs.

Sets the directory used for `getPath('logs')`. Called without an argument, it pins `logs` to its current default.

```ts
import { app } from 'bunmaska'

app.setAppLogsPath('/var/log/my-app')
```

### `app.getName()`

Returns `string` - the application name: the `setName` override if set, otherwise `productName` (falling back to `name`) from the app's `package.json`.

```ts
import { app } from 'bunmaska'

console.log(app.getName())
```

### `app.setName(name)`

* `name` string

Overrides the application name. This also changes the `userData` directory name, since that is derived from the app name.

```ts
import { app } from 'bunmaska'

app.setName('My Great App')
```

### `app.getVersion()`

Returns `string` - the application version from the app's `package.json`.

```ts
import { app } from 'bunmaska'

console.log(app.getVersion())
```

### `app.getLocale()`

Returns `string` - the current application locale as a normalized BCP-47 tag.

```ts
import { app } from 'bunmaska'

console.log(app.getLocale()) // e.g. 'en-US'
```

### `app.getSystemLocale()`

Returns `string` - the system locale. In Bunmaska this matches `getLocale()` (there is a single resolved host locale rather than Electron's separate Chromium/OS sources).

```ts
import { app } from 'bunmaska'

console.log(app.getSystemLocale())
```

### `app.getLocaleCountryCode()`

Returns `string` - the two-letter country/region code of the current locale, or `''` if it cannot be determined.

```ts
import { app } from 'bunmaska'

console.log(app.getLocaleCountryCode()) // e.g. 'US'
```

### `app.getPreferredSystemLanguages()`

Returns `string[]` - the user's preferred languages, most-preferred first.

```ts
import { app } from 'bunmaska'

console.log(app.getPreferredSystemLanguages()) // e.g. ['en-US', 'fr-FR']
```

### `app.setActivationPolicy(policy)` _macOS_

* `policy` string - `'regular'`, `'accessory'`, or `'prohibited'`.

Sets the macOS activation policy. No-op off macOS.

```ts
import { app } from 'bunmaska'

app.setActivationPolicy('accessory') // hide from the Dock
```

### `app.hide()` _macOS_

Hides all application windows without minimizing them. No-op off macOS.

```ts
import { app } from 'bunmaska'

app.hide()
```

### `app.show()` _macOS_

Shows application windows after they were hidden with `hide()`. No-op off macOS.

```ts
import { app } from 'bunmaska'

app.show()
```

### `app.isHidden()` _macOS_

Returns `boolean` - `true` if the application is hidden. Always `false` off macOS.

```ts
import { app } from 'bunmaska'

if (app.isHidden()) app.show()
```

### `app.isActive()` _macOS_

Returns `boolean` - `true` if the application is the active (focused) app. Always `false` off macOS.

```ts
import { app } from 'bunmaska'

console.log(app.isActive())
```

### `app.showAboutPanel()`

Shows the platform's standard about panel. No-op where unsupported.

```ts
import { app } from 'bunmaska'

app.showAboutPanel()
```

Bunmaska does not implement `setAboutPanelOptions` - the panel uses platform defaults.

### `app.setBadgeCount([count])` _macOS_

* `count` Integer (optional) - defaults to `0`. `0` hides the badge.

Sets the app's badge count. On macOS this is shown on the dock tile. The value is always cached for `getBadgeCount` regardless of platform. Returns `boolean` - whether it was actually displayed (`false` off macOS).

```ts
import { app } from 'bunmaska'

app.setBadgeCount(3)
```

### `app.getBadgeCount()` _macOS_

Returns `Integer` - the last badge count set via `setBadgeCount` (cached on all platforms).

```ts
import { app } from 'bunmaska'

console.log(app.getBadgeCount())
```

### `app.requestSingleInstanceLock([additionalData])`

* `additionalData` unknown (optional) - JSON-serializable data forwarded to the primary instance.

Returns `boolean` - `true` if this is the primary instance and your app should continue loading; `false` if another instance already holds the lock (in which case this process's `argv`/`cwd`/`additionalData` have been handed to the primary via its `second-instance` event, and you should quit).

```ts
import { app, BrowserWindow } from 'bunmaska'

let mainWindow: BrowserWindow | null = null

const gotTheLock = app.requestSingleInstanceLock({ from: 'cli' })

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, argv, workingDirectory, additionalData) => {
    if (mainWindow) mainWindow.focus()
  })

  app.whenReady().then(() => {
    mainWindow = new BrowserWindow({})
  })
}
```

### `app.hasSingleInstanceLock()`

Returns `boolean` - whether this process currently holds the single-instance lock.

```ts
import { app } from 'bunmaska'

console.log(app.hasSingleInstanceLock())
```

### `app.releaseSingleInstanceLock()`

Releases the single-instance lock held by this process, allowing other instances to run again.

```ts
import { app } from 'bunmaska'

app.releaseSingleInstanceLock()
```

## Events

The `app` object emits the following events.

### Event: 'ready'

Returns:

* `event` Event

Emitted once, when Bunmaska has finished initializing and is ready to create windows. Fires at most once. You can also check the `isReady` property or use `whenReady()`.

Note: unlike Electron, Bunmaska's `ready` does not carry a `launchInfo` argument.

```ts
import { app } from 'bunmaska'

app.on('ready', () => {
  // ready to create windows
})
```

### Event: 'before-quit'

Returns:

* `event` Event

Emitted first when a quit begins (via `app.quit()`). Calling `event.preventDefault()` aborts the quit.

```ts
import { app } from 'bunmaska'

app.on('before-quit', (event) => {
  event.preventDefault()
})
```

### Event: 'will-quit'

Returns:

* `event` Event

Emitted after `before-quit` is not vetoed, immediately before the app quits. Calling `event.preventDefault()` aborts the quit. The native bootstrap also listens for this to stop the run loop before the process exits.

```ts
import { app } from 'bunmaska'

app.on('will-quit', (event) => {
  // last chance to clean up; call event.preventDefault() to stay alive
})
```

### Event: 'quit'

Returns:

* `event` Event - the exit code (Integer).

Emitted when the application is quitting, just before the process exits. Unlike most events, the listener receives the numeric exit code as its argument.

```ts
import { app } from 'bunmaska'

app.on('quit', (exitCode) => {
  console.log(`quitting with code ${exitCode}`)
})
```

### Event: 'second-instance'

Returns:

* `event` Event
* `argv` string[] - the second instance's command-line arguments.
* `workingDirectory` string - the second instance's working directory.
* `additionalData` unknown - the JSON data the second instance passed to `requestSingleInstanceLock`.

Emitted inside the primary instance when a second instance starts and calls `app.requestSingleInstanceLock()`. Typically used to focus the existing window. See the `requestSingleInstanceLock` example above.

### Event: 'window-all-closed'

Emitted when all windows have been closed. As in Electron, if you subscribe to this event you take responsibility for deciding whether the app quits.

```ts
import { app } from 'bunmaska'

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

## Properties

### `app.isReady`

A `boolean` property - `true` if the `ready` event has already fired. This is the property form Bunmaska exposes; there is no `isReady()` method.

```ts
import { app } from 'bunmaska'

if (!app.isReady) {
  await app.whenReady()
}
```

### `app.isPackaged` _Readonly_

A `boolean` - `true` if the app is running from a packaged build, `false` under the dev runner. Useful for distinguishing development from production.

```ts
import { app } from 'bunmaska'

const baseURL = app.isPackaged ? 'app://index.html' : 'http://localhost:5173'
```

### `app.name`

A `string` accessor mirroring `getName()` / `setName()`.

```ts
import { app } from 'bunmaska'

app.name = 'My Great App'
console.log(app.name)
```

### `app.badgeCount` _macOS_

An `Integer` accessor mirroring `getBadgeCount()` / `setBadgeCount()`. Setting it on macOS updates the dock badge (`0` hides it); off macOS the value is still cached.

```ts
import { app } from 'bunmaska'

app.badgeCount = 5
```

### `app.applicationMenu`

A `Menu | null` accessor that gets/sets the application menu bar (delegates to `Menu.getApplicationMenu()` / `Menu.setApplicationMenu()`).

```ts
import { app, Menu } from 'bunmaska'

app.applicationMenu = Menu.buildFromTemplate([
  { label: 'File', submenu: [{ role: 'quit' }] }
])
```

### `app.userAgentFallback`

A `string` - the default User-Agent applied to new windows whose session has no explicit override. `''` means "use the platform WebKit default". A per-session `session.setUserAgent` takes precedence. Set this early in initialization.

```ts
import { app } from 'bunmaska'

app.userAgentFallback = 'MyApp/1.0'
```

### `app.dock` _macOS_ _Readonly_

A `Dock | undefined` property - the macOS dock object, or `undefined` on other platforms. The Bunmaska `Dock` is a small object with:

* `setBadge(text: string): void` - set the dock badge text (`''` clears it).
* `getBadge(): string` - the current dock badge text.
* `bounce(type?: 'critical' | 'informational'): void` - bounce the dock icon; `'critical'` bounces until the app is focused.

This is a narrower surface than Electron's `Dock` (no `setMenu`, `setIcon`, `show`/`hide`, `cancelBounce`, etc.).

```ts
import { app } from 'bunmaska'

app.dock?.setBadge('!')
app.dock?.bounce('critical')
```

## Not in Bunmaska (yet)

Bunmaska implements the lifecycle, paths, metadata, locale, single-instance, and macOS desktop core of Electron's `app`. The following notable Electron members are **not** implemented:

- **`app.focus()`** - no programmatic app/window focus from the `app` module.
- **`app.getFileIcon()`** - no file-icon lookup.
- **Protocol-client APIs** - `setAsDefaultProtocolClient`, `removeAsDefaultProtocolClient`, `isDefaultProtocolClient`, `getApplicationNameForProtocol`, `getApplicationInfoForProtocol` are all absent.
- **Recent-documents APIs** - `addRecentDocument`, `clearRecentDocuments`, `getRecentDocuments`.
- **GPU / hardware APIs** - `disableHardwareAcceleration`, `isHardwareAccelerationEnabled`, `disableDomainBlockingFor3DAPIs`, `getGPUFeatureStatus`, `getGPUInfo`, `getAppMetrics`. (Bunmaska runs on system WebKit, not Chromium, so the `chrome://gpu`-shaped surface does not exist.)
- **Networking** - `configureHostResolver`, `setProxy`, `resolveProxy`, `importCertificate`, `setClientCertRequestPasswordHandler`, `configureWebAuthn`.
- **Login items** - `getLoginItemSettings` / `setLoginItemSettings`.
- **Accessibility APIs** - `isAccessibilitySupportEnabled`, `setAccessibilitySupportEnabled`, `getAccessibilitySupportFeatures`, `setAccessibilitySupportFeatures`, and the `accessibilitySupportEnabled` property.
- **`setAboutPanelOptions`** - `showAboutPanel` exists but the panel is not configurable; also `isEmojiPanelSupported` / `showEmojiPanel`.
- **macOS Handoff / user-activity APIs** - `setUserActivity`, `getCurrentActivityType`, `invalidateCurrentActivity`, `resignCurrentActivity`, `updateCurrentActivity`, and the related `continue-activity*` / `activity-was-continued` / `update-activity-state` events.
- **macOS app-relocation / security APIs** - `isInApplicationsFolder`, `moveToApplicationsFolder`, `isSecureKeyboardEntryEnabled`, `setSecureKeyboardEntryEnabled`, `startAccessingSecurityScopedResource`, `enableSandbox`.
- **`getPath` names** - `recent` and `assets` are not supported.
- **Properties** - `commandLine`, `runningUnderARM64Translation`, and `accessibilitySupportEnabled` are not exposed.
- **Windows-only APIs** - `setUserTasks`, `getJumpListSettings`, `setJumpList`, `setAppUserModelId`, `setToastActivatorCLSID`, and the `toastActivatorCLSID` property. (Bunmaska is macOS + Linux only; there is no Windows target.)
- **Events** - many Electron `app` events are not emitted by this module, including `will-finish-launching`, `certificate-error`, `select-client-certificate`, `login`, `gpu-info-update`, `render-process-gone`, `child-process-gone`, `accessibility-support-changed`, `session-created`, and the macOS `did-become-active` / `did-resign-active` / `new-window-for-tab` events. Some cross-cutting events that Electron raises on `app` (e.g. `activate`, `open-url`, `open-file`, `browser-window-created`/`-focus`/`-blur`, `web-contents-created`) are reserved as listenable names but are emitted by the window/web-contents subsystems rather than by this module - consult those modules' docs for current coverage.

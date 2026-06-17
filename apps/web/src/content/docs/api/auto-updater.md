---
title: "autoUpdater"
description: "Application self-update for Bunmaska on macOS and Linux: an explicit check/download/install flow over a version.json feed, with no Squirrel and no Windows."
order: 23
---

Enables Bunmaska apps to update themselves from a channel feed that `bunmaska build` produces. It is a drop-in subset of Electron's `autoUpdater`, but built on plain Bun rather than Squirrel: it reads an `update.json` manifest, compares versions, downloads + integrity-checks the artifact (size and wyhash), decompresses (zstd) and stages a `.tar`, then relaunches via an installer seam.

Process: Main. The `autoUpdater` singleton is a Node.js [`EventEmitter`](https://nodejs.org/api/events.html). Two things that differ from Electron up front, so you don't get surprised:

- The flow is **electron-updater style**, not Electron-core style. `checkForUpdates()` does *not* download automatically - you call `downloadUpdate()` yourself once an update is available.
- It works on **macOS and Linux** (the only two platforms Bunmaska targets). There is no Windows and no Squirrel anywhere in this module.

```ts
import { autoUpdater } from 'bunmaska';

autoUpdater.setFeedURL({ url: 'https://updates.example.com/myapp/stable' });

autoUpdater.on('update-available', () => autoUpdater.downloadUpdate());
autoUpdater.on('update-downloaded', () => autoUpdater.quitAndInstall());
autoUpdater.on('error', (err) => console.error('update failed', err));

await autoUpdater.checkForUpdates();
```

## Methods

### `autoUpdater.setFeedURL(options)`

`setFeedURL(options: { url: string } | string): void`

Sets the base URL of the channel feed - the directory where `update.json` and the build artifacts live. Accepts either an options object or a bare string. Throws if the URL is missing or empty.

Note the shape: Bunmaska accepts only a `url`. Electron's `headers`, `serverType`, and `allowAnyVersion` options are not implemented (the feed is a static directory + JSON, so there's nothing to authenticate or negotiate).

```ts
import { autoUpdater } from 'bunmaska';

// object form
autoUpdater.setFeedURL({ url: 'https://updates.example.com/myapp/stable' });

// string form is also accepted
autoUpdater.setFeedURL('https://updates.example.com/myapp/canary');
```

### `autoUpdater.getFeedURL()`

`getFeedURL(): string`

Returns the configured feed URL, or `''` if `setFeedURL` has not been called yet.

```ts
import { autoUpdater } from 'bunmaska';

autoUpdater.setFeedURL({ url: 'https://updates.example.com/myapp/stable' });
console.log(autoUpdater.getFeedURL()); // "https://updates.example.com/myapp/stable"
```

### `autoUpdater.checkForUpdates()`

`checkForUpdates(): Promise<UpdateCheckResult | null>`

Fetches `<feedURL>/update.json` and compares its `version` against the running app's version. Emits `checking-for-update`, then either `update-available` or `update-not-available`.

Resolves to `{ updateInfo, manifest }` when a newer version exists, or `null` when the app is up to date. Rejects (and emits `error`) on a network or manifest-parse failure. You must call `setFeedURL` first, or it throws.

Unlike Electron, this does **not** trigger a download - it only tells you whether one is available.

```ts
import { autoUpdater } from 'bunmaska';

autoUpdater.setFeedURL({ url: 'https://updates.example.com/myapp/stable' });

const result = await autoUpdater.checkForUpdates();
if (result) {
  console.log(`update ${result.updateInfo.version} available`);
} else {
  console.log('already on the latest version');
}
```

### `autoUpdater.downloadUpdate()`

`downloadUpdate(): Promise<StagedUpdate>`

Downloads the artifact for the update found by the most recent `checkForUpdates()`, verifies its byte length and wyhash content hash against the manifest, decompresses it (zstd), and stages the resulting `.tar` on disk. Emits `update-downloaded` on success.

Rejects (and emits `error`) if no update is pending - call `checkForUpdates()` first - or if the integrity check fails. Resolves to a `StagedUpdate` (`{ manifest, tarPath }`).

This explicit step has no equivalent in Electron's core `autoUpdater` (where download is implicit); it mirrors `electron-updater`.

```ts
import { autoUpdater } from 'bunmaska';

autoUpdater.on('update-available', async () => {
  const staged = await autoUpdater.downloadUpdate();
  console.log(`staged ${staged.manifest.version} at ${staged.tarPath}`);
});
```

### `autoUpdater.quitAndInstall()`

`quitAndInstall(): void`

Installs the staged update and relaunches, via the installer seam. Throws if nothing has been downloaded - call `downloadUpdate()` first. Should only be called after `update-downloaded` has been emitted.

> **Note:** the default installer is **EXPERIMENTAL**. It hands the staged tar to a best-effort, platform-specific swap-and-relaunch and is the one step not exercised by Bunmaska's test suite. Apps that need deterministic installs should inject their own installer (see _Replacing the installer_ below). _macOS_ and _Linux_ bundle layouts differ, which is exactly why this step is fenced off.

```ts
import { autoUpdater } from 'bunmaska';

autoUpdater.on('update-downloaded', () => {
  // closes the app and relaunches into the new build
  autoUpdater.quitAndInstall();
});
```

## Events

The `autoUpdater` object emits the following events.

### Event: 'checking-for-update'

Emitted when `checkForUpdates()` begins. No arguments.

```ts
import { autoUpdater } from 'bunmaska';

autoUpdater.on('checking-for-update', () => console.log('checking…'));
```

### Event: 'update-available'

Returns:

- `updateInfo` UpdateInfo - `{ version, releaseName }`.

Emitted when a newer version is found. The update is **not** downloaded automatically - call `downloadUpdate()` in this handler if you want it.

```ts
import { autoUpdater } from 'bunmaska';

autoUpdater.on('update-available', (info) => {
  console.log(`v${info.version} (${info.releaseName}) is available`);
  autoUpdater.downloadUpdate();
});
```

### Event: 'update-not-available'

Returns:

- `updateInfo` UpdateInfo - the manifest's `{ version, releaseName }`, even though it isn't newer.

Emitted when the feed's version is not newer than the running app.

```ts
import { autoUpdater } from 'bunmaska';

autoUpdater.on('update-not-available', () => console.log('up to date'));
```

### Event: 'update-downloaded'

Returns:

- `updateInfo` UpdateInfo - `{ version, releaseName }`.

Emitted after `downloadUpdate()` has fetched, verified, and staged the update. Call `quitAndInstall()` to apply it.

Note the payload differs from Electron: Bunmaska emits a single `UpdateInfo` object. Electron's `releaseNotes`, `releaseDate`, and `updateURL` fields are not present, because the `version.json` manifest does not carry them.

```ts
import { autoUpdater } from 'bunmaska';

autoUpdater.on('update-downloaded', (info) => {
  console.log(`v${info.version} ready to install`);
});
```

### Event: 'error'

Returns:

- `error` Error

Emitted when a check, download, integrity check, or install fails. As in Electron, attach a listener - an unhandled `error` event on an `EventEmitter` will throw. (Internally, the updater only emits `error` when a listener is attached, but the promise still rejects either way, so always handle one or the other.)

```ts
import { autoUpdater } from 'bunmaska';

autoUpdater.on('error', (err) => console.error('auto-update error:', err));
```

## Types

For reference, the small object shapes used above:

```ts
type UpdateInfo = { version: string; releaseName: string };

type StagedUpdate = {
  manifest: UpdateManifest; // parsed update.json
  tarPath: string;          // decompressed .tar staged on disk
};

type UpdateCheckResult = { updateInfo: UpdateInfo; manifest: UpdateManifest };
```

## Replacing the installer

Every side effect (network fetch, decompress, disk staging, install) is an injectable dependency, which is how the check/download/verify engine stays unit-testable. The most useful seam for production apps is `install`: supply your own to replace the experimental default with a deterministic, signed swap.

```ts
import { AutoUpdaterImpl } from 'bunmaska';

const updater = new AutoUpdaterImpl({
  install: (staged) => {
    // staged.tarPath is the verified, decompressed bundle
    myDeterministicInstaller.applyAndRelaunch(staged.tarPath);
  },
});
```

`setDepsForTesting()` exists too, but as the name says, it is for tests - don't reach for it in app code.

## Not in Bunmaska (yet)

Compared to Electron's `autoUpdater`, the following are intentionally absent:

- **Windows / Squirrel.Windows / MSIX** - Bunmaska has no Windows target, so there is no MSIX detection, no `allowAnyVersion` downgrade option, and no `--squirrel-firstrun` handling. The whole Squirrel layer is gone on every platform; updates are plain tar + zstd over a static feed.
- **Squirrel.Mac** - even on macOS there is no Squirrel. Integrity is a wyhash content hash + byte-length check against the manifest, and you are responsible for code-signing the swapped bundle yourself.
- **Event: `before-quit-for-update`** - not emitted. `quitAndInstall()` goes straight through the installer seam (the default calls `app.quit()`).
- **Automatic download** - Electron downloads as soon as an update is available; Bunmaska makes it an explicit `downloadUpdate()` call (electron-updater style). This is a deliberate behavioral difference, not a missing feature.
- **`setFeedURL` options `headers`, `serverType`, `allowAnyVersion`** - only `{ url }` (or a bare string) is accepted. The feed is a static directory, so there's nothing to send headers to or negotiate a server type with.
- **Rich `update-downloaded` payload** - `releaseNotes`, `releaseName` as a standalone arg, `releaseDate`, and `updateURL` are not provided. You get a single `UpdateInfo` (`version`, `releaseName`); the `version.json` manifest carries nothing more.

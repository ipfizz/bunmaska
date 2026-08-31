---
title: "autoUpdater"
description: "Application self-update for Bunmaska on macOS, Linux, and Windows: check/download/verify over an Ed25519-signed feed, with a real swap-and-relaunch installer."
order: 23
---

Enables Bunmaska apps to update themselves from a channel feed that `bunmaska build --update` produces. It is a drop-in subset of Electron's `autoUpdater`, but built on plain Bun rather than Squirrel: it reads an `update.json` manifest, compares versions, downloads the artifact, verifies its **Ed25519 signature** plus size and content hash, decompresses (zstd) and stages a `.tar`, then swaps the installed bundle and relaunches via a detached helper.

Process: Main. The `autoUpdater` singleton is a Node.js [`EventEmitter`](https://nodejs.org/api/events.html). Two things that differ from Electron up front, so you don't get surprised:

- The flow is **electron-updater style**, not Electron-core style. `checkForUpdates()` does *not* download automatically - you call `downloadUpdate()` yourself once an update is available.
- **Updates must be signed.** `downloadUpdate()` refuses to install anything without a valid detached `.sig` matching the `publicKey` you pass to `setFeedURL`. Generate the key pair with [`bunmaska keygen`](/docs/cli), sign releases with `bunmaska build --update --update-key`, and bake the public key into your app. An integrity hash alone is not trust - a compromised feed controls the manifest, so only the signature proves the bytes came from you.

```ts
import { autoUpdater } from 'bunmaska';

autoUpdater.setFeedURL({
  url: 'https://updates.example.com/myapp/stable',
  publicKey: UPDATE_PUBLIC_KEY_PEM, // from `bunmaska keygen`
});

autoUpdater.on('update-available', () => autoUpdater.downloadUpdate());
autoUpdater.on('update-downloaded', () => autoUpdater.quitAndInstall());
autoUpdater.on('error', (err) => console.error('update failed', err));

await autoUpdater.checkForUpdates();
```

The end-to-end publishing flow (keygen, build flags, hosting the feed) is walked through in [Building & Distribution](/docs/building).

## Methods

### `autoUpdater.setFeedURL(options)`

`setFeedURL(options: { url: string; publicKey?: string; channel?: string } | string): void`

Sets the base URL of the channel feed - the directory where `update.json`, the artifact, and its `.sig` live. Accepts either an options object or a bare string. Throws if the URL is missing, empty, or unparseable.

The URL must be **https**; a plaintext feed is refused at set time (`http` is allowed only for `localhost`/`127.0.0.1`/`[::1]`, so you can test against a local server).

- `publicKey` - the PEM Ed25519 public key every downloaded artifact's `.sig` must verify against. This is *your* release key from `bunmaska keygen`, baked into your app - not a Bunmaska key. Without it, `downloadUpdate()` refuses to download anything.
- `channel` - if set, a manifest whose `channel` differs is rejected (guards against channel confusion, e.g. a canary build being offered to stable users).

Electron's `headers`, `serverType`, and `allowAnyVersion` options are not implemented (the feed is a static directory + JSON, so there's nothing to authenticate or negotiate).

```ts
import { autoUpdater } from 'bunmaska';

// object form - what production apps should use
autoUpdater.setFeedURL({
  url: 'https://updates.example.com/myapp/stable',
  publicKey: UPDATE_PUBLIC_KEY_PEM,
  channel: 'stable',
});

// string form is accepted, but leaves no publicKey - fine for checking,
// useless for downloading
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

Resolves to `{ updateInfo, manifest }` when a newer version exists, or `null` when the app is up to date. Rejects (and emits `error`) on a network or manifest-parse failure, when the manifest targets a different OS/architecture than the running build, or when its `channel` differs from the one you configured. You must call `setFeedURL` first, or it throws.

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

Downloads the artifact for the update found by the most recent `checkForUpdates()` and runs the full verification chain:

1. **Size caps** - the declared compressed size must be within 512 MB *before* any bytes are fetched, and the decompressed tar within 2 GB (a zip-bomb guard).
2. **Byte length + wyhash** - the downloaded bytes must match the manifest's `size` and `hash`.
3. **Ed25519 signature** - `<artifact>.sig` is fetched from the feed and verified against the `publicKey` from `setFeedURL`. No key configured, or a bad signature, and the whole download rejects - **unsigned updates are refused**.

Only then is the artifact decompressed (zstd) and the resulting `.tar` staged on disk. Emits `update-downloaded` on success. Rejects (and emits `error`) if no update is pending - call `checkForUpdates()` first - or if any step above fails. Resolves to a `StagedUpdate` (`{ manifest, tarPath }`).

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

Installs the staged update and relaunches. Throws if nothing has been downloaded - call `downloadUpdate()` first. Should only be called after `update-downloaded` has been emitted.

The default installer is a real swap, not a stub: it writes a small detached helper (a `/bin/sh` script on macOS/Linux, a `cmd` script on Windows), quits the app, and the helper then waits for the process to exit, extracts the staged tar into a **temp sibling** of the install root, rename-swaps it into place (so a half-finished extract can never brick the installed app - the second rename rolls back the first on failure), relaunches the new build, and deletes itself.

Two honest caveats:

- It refuses to swap when the running process is not an installed bundle (e.g. `bun main.ts` in dev, or a bare binary outside the `.app`/AppDir/portable-dir layout `bunmaska build` produces) - it logs a warning and just quits, leaving the staged tar in place.
- The helper-script *generators* are unit-tested on all three platforms; the live swap itself is the one step the test suite does not exercise end to end. If you need a different install strategy, the installer is injectable (see _Replacing the installer_ below).

```ts
import { autoUpdater } from 'bunmaska';

autoUpdater.on('update-downloaded', () => {
  // quits the app; a detached helper swaps the bundle and relaunches
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

Emitted after `downloadUpdate()` has fetched, verified (size, hash, signature), and staged the update. Call `quitAndInstall()` to apply it.

Note the payload differs from Electron: Bunmaska emits a single `UpdateInfo` object. Electron's `releaseNotes`, `releaseDate`, and `updateURL` fields are not present, because the `update.json` manifest does not carry them.

```ts
import { autoUpdater } from 'bunmaska';

autoUpdater.on('update-downloaded', (info) => {
  console.log(`v${info.version} ready to install`);
});
```

### Event: 'error'

Returns:

- `error` Error

Emitted when a check, download, verification, or install fails. As in Electron, attach a listener - an unhandled `error` event on an `EventEmitter` will throw. (Internally, the updater only emits `error` when a listener is attached, but the promise still rejects either way, so always handle one or the other.)

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

Every side effect (network fetch, decompress, disk staging, install) is an injectable dependency, which is how the check/download/verify engine stays unit-testable. The most useful seam for apps with special install requirements is `install`: supply your own to replace the default detached swap-and-relaunch.

```ts
import { AutoUpdaterImpl } from 'bunmaska';

const updater = new AutoUpdaterImpl({
  install: (staged) => {
    // staged.tarPath is the verified, decompressed bundle
    myInstaller.applyAndRelaunch(staged.tarPath);
  },
});
```

`setDepsForTesting()` exists too, but as the name says, it is for tests - don't reach for it in app code.

## Not in Bunmaska (yet)

Compared to Electron's `autoUpdater`, the following are intentionally absent:

- **Squirrel.Windows / MSIX** - Bunmaska runs the same plain tar + zstd pipeline on Windows as elsewhere, so there is no Squirrel.Windows, no MSIX detection, no `allowAnyVersion` downgrade option, and no `--squirrel-firstrun` handling.
- **Squirrel.Mac** - even on macOS there is no Squirrel. Trust comes from the Ed25519 signature on the artifact; code-signing the swapped bundle for Gatekeeper is still on you (sign what you feed to `bunmaska build --update`).
- **Event: `before-quit-for-update`** - not emitted. `quitAndInstall()` goes straight through the installer seam (the default calls `app.quit()` after spawning the helper).
- **Automatic download** - Electron downloads as soon as an update is available; Bunmaska makes it an explicit `downloadUpdate()` call (electron-updater style). This is a deliberate behavioral difference, not a missing feature.
- **`setFeedURL` options `headers`, `serverType`, `allowAnyVersion`** - the accepted options are `url`, `publicKey`, and `channel`. The feed is a static directory, so there's nothing to send headers to or negotiate a server type with.
- **Rich `update-downloaded` payload** - `releaseNotes`, `releaseName` as a standalone arg, `releaseDate`, and `updateURL` are not provided. You get a single `UpdateInfo` (`version`, `releaseName`); the `update.json` manifest carries nothing more.

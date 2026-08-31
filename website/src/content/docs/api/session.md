---
title: "session"
description: "The main-process session module in Bunmaska: a default session with a cookie store (macOS/Linux), a process-wide User-Agent override, and storage-data clearing."
order: 22
---

In Electron, `session` is the kitchen sink for cookies, cache, proxy, permissions, network interception and more. In Bunmaska it is currently a much smaller thing: a single **default session** that owns a **cookie store** (`ses.cookies` - get/set/remove, on macOS and Linux), a process-wide User-Agent override, and a data-store clear. That is the honest extent of it today - no partitions, no proxy, no `webRequest`.

Process: Main

The module exposes one object, `session`, whose only property is `defaultSession`. There is no constructor and no factory (`fromPartition` / `fromPath` are not implemented), so every window shares the one default session.

```ts
import { app, session } from 'bunmaska';

app.whenReady().then(() => {
  console.log(session.defaultSession.getUserAgent()); // '' until you set one
});
```

## Properties

### `session.defaultSession`

A `Session` object - the app's single default session. Unlike Electron, this is the *only* session Bunmaska gives you; there is no per-partition or per-path session yet.

```ts
import { session } from 'bunmaska';

const ses = session.defaultSession;
ses.setUserAgent('MyApp/1.0');
```

## Class: Session

A `Session` is not constructed directly - you reach it through `session.defaultSession`. It carries the cookie store, the User-Agent override, and the data-clearing call.

### `ses.cookies` _Readonly_

A `Cookies` object for the session's cookie store. _macOS, Linux_ - on Windows every method rejects with an `UnsupportedPlatformError`, because the WinCairo WebKit C API exposes no cookie read/write entry points (it can delete-all, which `clearStorageData` uses, but not enumerate or set).

```ts
import { session } from 'bunmaska';

const { cookies } = session.defaultSession;
```

## Class: Cookies

Query and modify the session's cookies - Electron's `Cookies` subset, minus events and `flushStore`.

### `cookies.get(filter)`

`get(filter?: { url?: string; name?: string; domain?: string; path?: string }): Promise<Cookie[]>` _macOS, Linux_

Resolves with the cookies matching `filter`; an empty or omitted filter returns all cookies. `url` matches by the URL's host and path (RFC 6265 domain-matching); `domain` matches the cookie's domain or any subdomain of it.

Each `Cookie` is `{ name, value, domain, path, secure, httpOnly, expirationDate? }` - `expirationDate` is unix seconds, and its absence means a session cookie.

```ts
const all = await session.defaultSession.cookies.get({});
const forSite = await session.defaultSession.cookies.get({ url: 'https://example.com' });
```

### `cookies.set(details)`

`set(details: { url: string; name?: string; value?: string; domain?: string; path?: string; secure?: boolean; httpOnly?: boolean; expirationDate?: number }): Promise<void>` _macOS, Linux_

Stores a cookie. `url` is required (it throws without one); `domain` and `path` are derived from it when absent. Omitting `expirationDate` makes a session cookie.

One platform caveat: **macOS accepts but cannot persist `httpOnly`** - `NSHTTPCookie` exposes no public property key for it, so the flag is dropped on write. Linux persists it.

```ts
await session.defaultSession.cookies.set({
  url: 'https://example.com',
  name: 'token',
  value: 'abc123',
  expirationDate: Date.now() / 1000 + 86400,
});
```

### `cookies.remove(url, name)`

`remove(url: string, name: string): Promise<void>` _macOS, Linux_

Deletes every cookie named `name` that matches `url`'s host and path. Both arguments are required.

```ts
await session.defaultSession.cookies.remove('https://example.com', 'token');
```

### `ses.getUserAgent()`

`getUserAgent(): string`

Returns the session's User-Agent override, or `''` when none has been set. An empty string means the underlying platform WebKit default User-Agent is used.

```ts
import { session } from 'bunmaska';

const ua = session.defaultSession.getUserAgent();
console.log(ua === '' ? 'using WebKit default' : ua);
```

### `ses.setUserAgent(userAgent)`

`setUserAgent(userAgent: string): void`

Sets a process-wide default User-Agent. The important nuance: this is applied by every `BrowserWindow` created **after** this call, at construction time, before its first navigation. Windows that already exist keep their current User-Agent - to change a live one, use `webContents.setUserAgent(ua)`.

Note this is narrower than Electron's `setUserAgent(userAgent[, acceptLanguages])`: there is no `acceptLanguages` parameter.

```ts
import { app, BrowserWindow, session } from 'bunmaska';

app.whenReady().then(() => {
  // Set the default BEFORE creating windows that should use it.
  session.defaultSession.setUserAgent('MyApp/1.0 (compatible)');

  const win = new BrowserWindow({ width: 800, height: 600 });
  win.loadURL('https://example.com'); // request goes out with MyApp/1.0

  // Override a live window's UA directly on its web contents:
  win.webContents.setUserAgent('MyApp/1.0 (special page)');
});
```

### `ses.clearStorageData()`

`clearStorageData(): Promise<void>` _macOS, Windows_

Clears the default data store's website data and resolves when the clear completes.

This is the all-or-nothing form. Bunmaska does not yet accept Electron's `options` argument (`origin` / `storages`), so you cannot scope the clear to a specific origin or storage type.

Platform notes on exactly _what_ gets cleared:

- **macOS** - clears **all** website data: cache, cookies, local and session storage, IndexedDB, and the rest.
- **Windows** - clears cookies and the fetch/HTTP caches. Clearing local storage and IndexedDB is a follow-up, so it is **not** the full wipe macOS performs yet.
- **Linux** - not yet wired: `clearStorageData` currently rejects with an `UnsupportedPlatformError` (`WebKitWebsiteDataManager` clearing is a follow-up).

```ts
import { session } from 'bunmaska';

async function signOut() {
  // macOS: clears everything. Windows: clears cookies + fetch caches.
  // Linux: rejects (not yet wired).
  await session.defaultSession.clearStorageData();
}
```

## Not in Bunmaska (yet)

The default session is deliberately minimal right now. Compared to Electron's `session` module, the following are **not** implemented:

- **`session.fromPartition()` / `session.fromPath()`** - no partitioned or path-based sessions; there is only `defaultSession`. The `cache` option and `persist:` semantics don't exist.
- **`ses.clearStorageData(options)`** - the `origin` and `storages` scoping options are ignored/absent; only the unscoped clear exists. It works on macOS (full wipe) and Windows (cookies + fetch caches; local/IndexedDB clearing is a follow-up); Linux rejects.
- **Cookie extras** - `cookies.get`/`set`/`remove` exist (macOS/Linux; Windows rejects), but not the `changed` event, `flushStore()`, or set-details fields beyond the documented ones (`sameSite` is not stored).
- **Cache (`ses.getCacheSize()`, `ses.clearCache()`)** - no granular cache inspection or HTTP-cache-only clear (use `clearStorageData()`, which clears everything on macOS and cookies + fetch caches on Windows).
- **Proxy (`ses.setProxy()`, `ses.resolveProxy()`, `ses.forceReloadProxyConfig()`)** - no proxy configuration.
- **Network interception (`ses.webRequest`, `ses.protocol`, `ses.fetch()`)** - no request interception, custom protocols, or main-process fetch.
- **Permissions (`ses.setPermissionRequestHandler()`, `ses.setPermissionCheckHandler()`, `ses.setDisplayMediaRequestHandler()`)** - no permission plumbing.
- **Device access (`ses.setDevicePermissionHandler()`, `ses.setBluetoothPairingHandler()`, `select-hid-device` / `select-serial-port` / `select-usb-device` events)** - not present.
- **Downloads (`ses.downloadURL()`, `ses.setDownloadPath()`, the `will-download` event)** - no download management.
- **Networking knobs (`ses.enableNetworkEmulation()`, `ses.setCertificateVerifyProc()`, `ses.setSSLConfig()`, `ses.resolveHost()`, `ses.allowNTLMCredentialsForDomains()`, `ses.preconnect()`, `ses.closeAllConnections()`)** - none implemented.
- **Extensions (`ses.loadExtension()`, the `extension-loaded` / `extension-ready` / `extension-unloaded` events)** - no extension support.
- **Spellcheck (`ses.setSpellCheckerLanguages()` and the `spellcheck-dictionary-*` events)** - not implemented.
- **`acceptLanguages` argument to `setUserAgent`** - only the User-Agent string is honored.
- **Events** - the `Session` class emits no events at all yet (no `will-download`, no device events, etc.).

If your app needs cookie CRUD (macOS/Linux), a custom User-Agent, and a storage-clearing button (a full wipe on macOS, cookies + fetch caches on Windows; not yet on Linux), the current surface covers it. Anything proxy-, permission-, or interception-shaped is still on the roadmap.

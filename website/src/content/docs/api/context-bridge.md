---
title: "contextBridge"
description: "Renderer-side API for exposing a safe, async-only bridge from an isolated Bunmaska preload world to the page."
order: 6
---

Create a safe bridge from an isolated preload world into the page's main world. In Bunmaska the preload (and this `contextBridge`) run in a dedicated isolated JS world - `WKContentWorld 'BunmaskaPreload'` on macOS, the `BunmaskaPreload` named world on Linux - so the page cannot see preload globals directly. `exposeInMainWorld` bridges across that boundary using a shared-`document` `CustomEvent` channel, materialising `window[apiKey]` in the page.

Process: Renderer (preload)

The bridge is real isolation, but the transport is a DOM event channel rather than Electron's V8 boundary. That buys two unavoidable rules you should internalise before reading further: **exposed functions are async-only** (every method on the page side returns a `Promise`), and **everything crosses by structured clone** (data only - no callbacks, no live references). More on that under each method.

```ts
// Preload (runs in the isolated BunmaskaPreload world)
import { contextBridge, ipcRenderer } from 'bunmaska/renderer';

contextBridge.exposeInMainWorld('app', {
  ping: () => ipcRenderer.invoke('ping'),
  version: '1.0.0',
});
```

```js
// Page (main world)
await window.app.ping(); // Promise - note the await
window.app.version;      // '1.0.0' (frozen)
```

## Methods

### `contextBridge.exposeInMainWorld(apiKey, api)`

- `apiKey` string - The key to inject the API onto `window` with. The API is accessible on `window[apiKey]`.
- `api` Record<string, unknown> - An object whose values are functions or cloneable data.

Installs a cross-world host (lazily, on first call) and announces a page-world stub at `window[apiKey]`. For each entry in `api`:

- **Function values** become async proxies. Calling `window[apiKey].method(...args)` dispatches a request event the isolated host answers, and returns a `Promise` that resolves with the result (or rejects with an `Error`). Arguments and the return value cross via structured clone, so you can pass strings, numbers, booleans, arrays, plain objects, and other cloneable types - but **not** functions, callbacks, or live object references. Even a synchronous-looking handler is async on the page side.
- **Non-function values** are deep-cloned and deep-frozen into the page object once, at expose time. Later mutations on the isolated side are **not** reflected back to the page.

Calls have a 30-second timeout: if the isolated host never replies, the page-side `Promise` rejects with a timeout error. Calling this outside the Bunmaska isolated preload world (where no cross-world channel exists) throws a `BunmaskaError`.

This is the only method on the module - and unlike Electron's, it is genuinely the whole surface.

```ts
import { contextBridge, ipcRenderer } from 'bunmaska/renderer';

contextBridge.exposeInMainWorld('electronAPI', {
  // async proxy - returns a Promise on the page side
  readConfig: () => ipcRenderer.invoke('config:read'),

  // args cross by structured clone (data only)
  saveNote: (note: { title: string; body: string }) =>
    ipcRenderer.invoke('note:save', note),

  // frozen data snapshot, copied once at expose time
  platform: process.platform,
});
```

```js
// Page (main world)
const cfg = await window.electronAPI.readConfig();
await window.electronAPI.saveNote({ title: 'hi', body: 'there' });
console.log(window.electronAPI.platform); // frozen string
```

#### Forwarding events from the preload

Because you cannot pass a callback *as an argument* across the bridge, the Electron pattern of taking a page callback and wiring it to `ipcRenderer.on` does not work unchanged - the function would not survive the structured clone. Subscribe inside the preload and expose a registration method whose own implementation lives on the isolated side:

```ts
import { contextBridge, ipcRenderer } from 'bunmaska/renderer';

const listeners = new Set<(value: number) => void>();
ipcRenderer.on('progress', (_e, value: number) => {
  for (const fn of listeners) fn(value);
});

contextBridge.exposeInMainWorld('progressAPI', {
  // The page can't hand us its callback over the bridge, so this is a
  // preload-side registry the page drives via async calls instead.
  poll: () => ipcRenderer.invoke('progress:current'),
});
```

## Not in Bunmaska (yet)

Bunmaska implements only `exposeInMainWorld`. The following Electron `contextBridge` members are **not** present in the source:

- **`exposeInIsolatedWorld(worldId, apiKey, api)`** - no arbitrary numeric world IDs. Bunmaska has exactly one isolated preload world (`BunmaskaPreload`); there is no API to target other worlds.
- **`executeInMainWorld(executionScript)`** (_Experimental_) - no way to serialize a function and run it in the main world from the preload.
- **Synchronous exposed functions** - not a named method, but a real semantic gap: in Electron, functions proxied over the bridge can return synchronously. In Bunmaska every exposed function is async (the page receives a `Promise`), because the transport is an async `CustomEvent` round-trip. Plan your API as async from the start.
- **Live, mutable non-function values** - Electron also copies-and-freezes, so this matches; just note Bunmaska snapshots data **once** at expose time with no later sync, same as Electron.

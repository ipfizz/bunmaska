---
title: "ipcRenderer"
description: "Send asynchronous and fire-and-forget messages from a renderer process to the main process, and listen for messages coming back."
order: 5
---

The `ipcRenderer` module lets a renderer process (your web page) talk to the main process: fire-and-forget `send`, request/response `invoke`, and listeners for messages pushed back from main. It is a thin, typed wrapper over the `globalThis.__bunmaska` bridge that Bunmaska installs into the preload world of every window's top frame, and it works on all three platforms - macOS (WKWebView), Linux (WebKitGTK), and Windows (WinCairo, where it runs in the page world).

Unlike Electron, Bunmaska's `ipcRenderer` is **not** an `EventEmitter` - it is a plain object with a fixed set of methods. There is no `sendSync`, no `postMessage`, and no `<webview>`/`sendToHost`. The `event` argument passed to listeners is currently a placeholder (an empty object), so don't reach for `event.sender` or `event.ports` yet.

Import it from `bunmaska/renderer` **in your preload**, and expose a narrow surface to the page with `contextBridge` - the same rule as Electron with `contextIsolation: true`. On macOS and Linux isolation is always on, so the bridge exists only in the preload: a page script that calls `ipcRenderer` gets a `BunmaskaError` pointing at `contextBridge`. Use `import`, never `require()`: an `import` gets bundled into the preload, while a `require` is injected as-is and the page has no `require` to call.

```ts
// preload.js
import { ipcRenderer } from 'bunmaska/renderer';
```

## Methods

### `ipcRenderer.send(channel, ...args)`

* `channel` string
* `...args` unknown[]

Sends an asynchronous, fire-and-forget message to the main process over `channel`, which listens with `ipcMain.on`. There is no return value and no acknowledgement - if you need a result back, use `invoke`.

Arguments are **JSON**-serialized, not structured-cloned as in Electron. Rather than let JSON silently drop or garble them, a function, symbol, `bigint`, `Map`, `Set`, `ArrayBuffer` or typed array throws a `TypeError` (`invoke` rejects with it). A `Date` still arrives as a string and `undefined` properties vanish, so send plain data.

```ts
import { ipcRenderer } from 'bunmaska/renderer';

ipcRenderer.send('counter:increment', 1);
ipcRenderer.send('log', { level: 'info', message: 'page loaded' });
```

### `ipcRenderer.invoke(channel, ...args)`

* `channel` string
* `...args` unknown[]

Returns `Promise<unknown>` - resolves with the value the main-process handler returns.

Sends a message to the main process and waits for a single reply, correlated by a request id. The main process answers with `ipcMain.handle`. If the handler rejects or throws, or returns something JSON cannot carry, the returned Promise rejects with an `Error` (the message is carried across the bridge; the `Error` instance is not the same object as the one thrown in main). As in Electron there is no timeout.

```ts
import { ipcRenderer } from 'bunmaska/renderer';

// A preload is bundled to a classic script, so await inside a function.
async function loadUser(userId) {
  try {
    return await ipcRenderer.invoke('db:getUser', userId);
  } catch (err) {
    console.error('lookup failed:', err);
    return null;
  }
}
```

### `ipcRenderer.on(channel, listener)`

* `channel` string
* `listener` (event: IpcRendererEvent, ...args: unknown[]) => void

Listens on `channel`. When the main process pushes a message (via `webContents.send`), `listener` is called as `listener(event, ...args)`. To match Electron's signature, the first argument is an `event` object - but in Bunmaska it is currently an **empty placeholder** (`{}`), with no `sender` or `ports`. Treat your real data as starting at the second argument.

Note: there is no `addListener` alias in Bunmaska - use `on`.

```ts
import { ipcRenderer } from 'bunmaska/renderer';

ipcRenderer.on('download:progress', (_event, percent) => {
  updateBar(percent as number);
});
```

### `ipcRenderer.once(channel, listener)`

* `channel` string
* `listener` (event: IpcRendererEvent, ...args: unknown[]) => void

Adds a one-time listener: it fires on the next message to `channel` and is then removed. The removal happens before the listener body runs, so a re-entrant dispatch can't fire it twice.

```ts
import { ipcRenderer } from 'bunmaska/renderer';

ipcRenderer.once('app:ready', (_event) => {
  console.log('main process is ready');
});
```

### `ipcRenderer.removeListener(channel, listener)`

* `channel` string
* `listener` (event: IpcRendererEvent, ...args: unknown[]) => void

Removes a previously registered `listener` from `channel`. You must pass the same function reference you gave to `on`/`once` - Bunmaska tracks the internal wrapper per `(channel, listener)` pair and unregisters the matching one.

Note: there is no `off` alias in Bunmaska - use `removeListener`.

```ts
import { ipcRenderer } from 'bunmaska/renderer';

const onTick = (_event: unknown, time: unknown) => console.log(time);

ipcRenderer.on('clock:tick', onTick);
// later
ipcRenderer.removeListener('clock:tick', onTick);
```

### `ipcRenderer.removeAllListeners([channel])`

* `channel` string (optional)

Removes every listener on `channel`. With no argument, removes all listeners on all channels.

```ts
import { ipcRenderer } from 'bunmaska/renderer';

ipcRenderer.removeAllListeners('download:progress');
ipcRenderer.removeAllListeners(); // clear everything
```

## Events

None. Bunmaska's `ipcRenderer` is a plain object, not an `EventEmitter`, so it emits no module-level events of its own. You receive messages by registering channel listeners with `on` / `once`.

## Properties

None beyond the methods above. The listener `event` object (`IpcRendererEvent`) is typed as `Record<string, never>` - an intentional empty placeholder, so it currently carries no `sender`, `ports`, or other fields.

## Not in Bunmaska (yet)

Compared with Electron's `ipcRenderer`, these members are **not** implemented:

* **`sendSync(channel, ...args)`** - no synchronous IPC. By design there's no blocking round-trip; use the async `invoke` instead.
* **`postMessage(channel, message, [transfer])`** - no `MessagePort` transfer to main. The bridge speaks JSON envelopes only, so there's no `MessagePortMain` story yet.
* **`sendToHost(channel, ...args)`** - no `<webview>` host channel, because Bunmaska has no `<webview>` tag.
* **`off` / `addListener` / `removeListener` aliases** - Electron exposes `off`, `addListener`, and a `removeListener` alias for `EventEmitter` parity. Bunmaska ships only the canonical `on`, `once`, `removeListener`, and `removeAllListeners`.
* **Rich `IpcRendererEvent`** - Electron's event carries `sender`, `senderId`, and `ports`. Bunmaska's event is an empty placeholder for now; sender/port details are slated for a later phase.

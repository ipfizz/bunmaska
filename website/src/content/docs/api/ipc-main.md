---
title: "ipcMain"
description: "Main-process IPC router for receiving messages and invoke requests from renderer processes in Bunmaska."
order: 4
---

The `ipcMain` module receives messages sent from renderer processes. It registers fire-and-forget channel listeners (`on`/`once`) and request/response handlers (`handle`) that respond to `ipcRenderer.invoke`. In Bunmaska the transport is WebKit-backed (a `WKScriptMessageHandler` inbound, `evaluateJavaScript` outbound) rather than Chromium's IPC, but the router itself is transport-agnostic and the API mirrors Electron's.

Unlike Electron, Bunmaska's `ipcMain` is **not** a Node.js `EventEmitter` - it is a small purpose-built router. That distinction matters in a few places, called out below. It is a singleton, imported from the main entry point:

```ts
import { ipcMain } from 'bunmaska';
```

To push messages the other way (main to renderer), use [`webContents.send`](/docs/api/web-contents); `ipcMain` only receives. Messages come from the preload's `ipcRenderer` (see [ipcRenderer](/docs/api/ipc-renderer)), and only from a window's top frame.

## Methods

### `ipcMain.on(channel, listener)`

* `channel` string
* `listener` Function
  * `event` IpcMainEvent
  * `...args` unknown[]

Listens on `channel`. When a renderer calls `ipcRenderer.send(channel, ...args)`, `listener` is called with `listener(event, ...args)`. Returns `this`, so calls chain. The `event` object carries `sender` (the originating `WebContents`) and `reply(channel, ...args)`; see [Properties](#properties). A listener that throws is caught and logged, and the other listeners on the channel still run.

```ts
import { ipcMain } from 'bunmaska';

ipcMain.on('counter:increment', (event, by: number) => {
  console.log('increment by', by, 'from', event.sender);
});
```

```ts
// preload.js
import { ipcRenderer } from 'bunmaska/renderer';

ipcRenderer.send('counter:increment', 1);
```

### `ipcMain.once(channel, listener)`

* `channel` string
* `listener` Function
  * `event` IpcMainEvent
  * `...args` unknown[]

Adds a one-time `listener`. It fires the next time a message arrives on `channel`, then removes itself. Returns `this`.

```ts
import { ipcMain } from 'bunmaska';

ipcMain.once('app:ready-handshake', (event) => {
  console.log('renderer handshook once', event.sender);
});
```

### `ipcMain.removeListener(channel, listener)`

* `channel` string
* `listener` Function

Removes a specific `listener` previously added with `on` or `once` for `channel`. Returns `this`. Pass the same function reference you registered.

```ts
import { ipcMain } from 'bunmaska';

const onPing = (event: unknown) => console.log('ping', event);

ipcMain.on('net:ping', onPing);
ipcMain.removeListener('net:ping', onPing);
```

### `ipcMain.removeAllListeners([channel])`

* `channel` string (optional)

Removes every listener registered on `channel`. With no argument, removes all listeners on all channels. Returns `this`. Note this only clears `on`/`once` listeners - it does not touch `handle` handlers (use `removeHandler` for those).

```ts
import { ipcMain } from 'bunmaska';

ipcMain.removeAllListeners('net:ping'); // one channel
ipcMain.removeAllListeners();           // everything
```

### `ipcMain.handle(channel, listener)`

* `channel` string
* `listener` Function\<Promise\<unknown\> | unknown\>
  * `event` IpcMainInvokeEvent
  * `...args` unknown[]

Registers a handler for an invokable IPC. It is called whenever a renderer runs `ipcRenderer.invoke(channel, ...args)`. If `listener` returns a Promise, its resolved value is sent back as the reply; otherwise the plain return value is used. There is exactly **one** handler per channel - calling `handle` again on the same channel replaces the previous handler.

If the handler throws (or rejects), the error is caught and only its `message` string is serialized back to the renderer, where the `invoke` Promise rejects. The original error object, stack, and custom properties do not cross the boundary. A result JSON cannot carry (a function, symbol or `bigint`) also rejects the `invoke`, instead of leaving it waiting forever.

```ts
import { ipcMain } from 'bunmaska';

ipcMain.handle('fs:read-config', async (event, name: string) => {
  const file = Bun.file(`./config/${name}.json`);
  return await file.json();
});
```

```ts
// preload.js (bundled to a classic script, so no top-level await)
import { ipcRenderer } from 'bunmaska/renderer';

ipcRenderer.invoke('fs:read-config', 'app').then((config) => console.log(config));
```

### `ipcMain.handleOnce(channel, listener)`

* `channel` string
* `listener` Function\<Promise\<unknown\> | unknown\>
  * `event` IpcMainInvokeEvent
  * `...args` unknown[]

Like `handle`, but the handler is removed after it responds to the first `invoke`. Subsequent invokes on the channel get the "no handler registered" rejection until you register again.

```ts
import { ipcMain } from 'bunmaska';

ipcMain.handleOnce('license:activate', async (event, key: string) => {
  return activate(key); // only honored once
});
```

### `ipcMain.removeHandler(channel)`

* `channel` string

Removes the handler registered for `channel`, if any. After this, an `invoke` on the channel rejects with `No handler registered for '<channel>'`.

```ts
import { ipcMain } from 'bunmaska';

ipcMain.removeHandler('fs:read-config');
```

## Events

`ipcMain` is a plain router in Bunmaska, not an `EventEmitter`, so it has no module-level lifecycle events of its own. All "events" are the user-defined channels you subscribe to via `on`/`once`.

## Properties

`ipcMain` exposes no public properties - it is the bare router singleton.

The `event` argument passed to your listeners and handlers carries:

* `event.sender` - the `WebContents` that sent the message, on both `IpcMainEvent` and `IpcMainInvokeEvent`. `BrowserWindow.fromWebContents(event.sender)` finds its window.
* `event.reply(channel, ...args)` - on `IpcMainEvent` only (the `on`/`once` event), as in Electron: sends back to the renderer the message came from, the same as `event.sender.send(...)`.

The richer Electron event shape is not present (see below).

## Not in Bunmaska (yet)

The router covers the everyday `on`/`once`/`handle` flow, but several Electron members are absent. Document-worthy gaps:

* **`ipcMain.off`, `ipcMain.addListener`** - these Electron aliases for `removeListener`/`on` do not exist. Use `removeListener` and `on` directly.
* **Synchronous IPC (`event.returnValue`)** - there is no synchronous `ipcRenderer.sendSync` path, so listeners cannot set `event.returnValue` to reply inline. Use `handle`/`invoke` for request/response instead.
* **`event.frameId` / `event.processId` / `event.senderFrame`** - frame and process routing metadata is not exposed; `event.sender` is all you get, and iframe-level addressing is not modeled.
* **`event.ports` and `MessagePort` transfer** - `MessagePortMain` / `postMessage` channels are not implemented; payloads cross as JSON, not structured clone. Functions, symbols and `bigint` are rejected on both sides, and the renderer side also rejects `Map`, `Set`, `ArrayBuffer` and typed arrays rather than letting JSON mangle them.
* **`EventEmitter` surface** - because `ipcMain` is not an `EventEmitter`, methods like `eventNames()`, `listenerCount()`, `setMaxListeners()`, and `prependListener()` are unavailable.
* **Full-fidelity error propagation** - `handle` errors are flattened to the `message` string only; stack traces and custom error properties are lost across the boundary (the same limitation Electron documents, noted here for parity).

Everything in the [Methods](#methods) section above is genuinely wired and exercised without FFI. The router is platform-neutral and the renderer-to-main transport (the WebKit script-message channel) works on all three platforms - macOS, Linux, and Windows.

One security note for Windows: there is no isolated world there yet, so the bridge lives in the page world and **any page script can invoke any handler**. If a window may load content you do not control, check `event.sender.getURL()` in the handlers that matter.

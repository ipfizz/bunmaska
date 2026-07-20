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

To push messages the other way (main to renderer), use [`webContents.send`](./web-contents.md); `ipcMain` only receives.

## Methods

### `ipcMain.on(channel, listener)`

* `channel` string
* `listener` Function
  * `event` IpcMainEvent
  * `...args` unknown[]

Listens on `channel`. When a renderer calls `ipcRenderer.send(channel, ...args)`, `listener` is called with `listener(event, ...args)`. Returns `this`, so calls chain. The `event` object exposes `sender` (the originating `WebContents`) - and only that; see [Not in Bunmaska (yet)](#not-in-bunmaska-yet).

```ts
import { ipcMain } from 'bunmaska';

ipcMain.on('counter:increment', (event, by: number) => {
  console.log('increment by', by, 'from', event.sender);
});
```

```ts
// Renderer Process
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

If the handler throws (or rejects), the error is caught and only its `message` string is serialized back to the renderer, where the `invoke` Promise rejects. The original error object, stack, and custom properties do not cross the boundary.

```ts
import { ipcMain } from 'bunmaska';

ipcMain.handle('fs:read-config', async (event, name: string) => {
  const file = Bun.file(`./config/${name}.json`);
  return await file.json();
});
```

```ts
// Renderer Process
import { ipcRenderer } from 'bunmaska/renderer';

const config = await ipcRenderer.invoke('fs:read-config', 'app');
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

The `event` argument passed to your listeners and handlers carries a single field:

* `event.sender` - the `WebContents` that sent the message. This is the only field on both `IpcMainEvent` and `IpcMainInvokeEvent` today. It is enough to identify and reply to a source via `event.sender.send(...)`, but the richer Electron event shape is not present (see below).

## Not in Bunmaska (yet)

The router covers the everyday `on`/`once`/`handle` flow, but several Electron members are absent. Document-worthy gaps:

* **`ipcMain.off`, `ipcMain.addListener`** - these Electron aliases for `removeListener`/`on` do not exist. Use `removeListener` and `on` directly.
* **Synchronous IPC (`event.returnValue`)** - there is no synchronous `ipcRenderer.sendSync` path, so listeners cannot set `event.returnValue` to reply inline. Use `handle`/`invoke` for request/response instead.
* **`event.reply(...)`** - the convenience reply helper is not on the event. To send back to a renderer, call `event.sender.send(channel, ...)` yourself.
* **`event.frameId` / `event.processId` / `event.senderFrame`** - frame and process routing metadata is not exposed; `event.sender` is all you get, and iframe-level addressing is not modeled.
* **`event.ports` and `MessagePort` transfer** - `MessagePortMain` / `postMessage` channels are not implemented; payloads cross as JSON, so functions, symbols, and `bigint` are rejected by the serializer.
* **`EventEmitter` surface** - because `ipcMain` is not an `EventEmitter`, methods like `eventNames()`, `listenerCount()`, `setMaxListeners()`, and `prependListener()` are unavailable.
* **Full-fidelity error propagation** - `handle` errors are flattened to the `message` string only; stack traces and custom error properties are lost across the boundary (the same limitation Electron documents, noted here for parity).

Everything in the [Methods](#methods) section above is genuinely wired and exercised without FFI. The router is platform-neutral and the renderer-to-main transport (the WebKit script-message channel) works on all three platforms - macOS, Linux, and Windows.

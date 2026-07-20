---
title: "protocol"
description: "Register custom URL schemes (e.g. app://) and serve bytes for them from the main process. Serving works on macOS and Linux; engine-blocked on Windows."
order: 17
---

Register a custom URL scheme and serve its requests from the main process. A handler bound to a scheme like `app` is invoked for every request to that scheme and returns the bytes plus MIME type to serve, so bundled assets can come from `app://host/index.html` without standing up a real HTTP server.

In Bunmaska the public surface is a single module-level registry (there is no per-`session` `protocol` object yet). The registry API itself - `handle`, `unhandle`, `isProtocolHandled`, `getRegisteredSchemes`, `dispatch`, etc. - exists on every platform, including Windows. What differs is **serving**: registered schemes are actually served to web views only on macOS (`WKURLSchemeHandler` via `setURLSchemeHandler:forURLScheme:`) and Linux (WebKitGTK's `webkit_web_context_register_uri_scheme`). On Windows serving is **engine-blocked** - the WinCairo WebKit2 C API exposes no custom-scheme-handler entry point, so a registered scheme such as `app://` will not serve there. Custom schemes must be registered **before** the window/web view that serves them is created - the native backends read the registered schemes at web-view creation and cannot add a scheme to a view that already exists.

> A note on the handler shape: unlike Electron's `protocol.handle`, which returns a web `Response`/`Promise<Response>`, Bunmaska's handler is **synchronous** and returns a small `{ data, mimeType }` object (or `undefined` to decline). Plan accordingly - see [Not in Bunmaska (yet)](#not-in-bunmaska-yet).

## Methods

### `protocol.handle(scheme, handler)`

* `scheme` string - the scheme to serve, e.g. `app`. The bit before the `:` in a URL.
* `handler` Function\<[ProtocolResponse](#types) | undefined\>
  * `request` [ProtocolRequest](#types) - has a single `url` property (the full request URL).

Registers `handler` to serve requests for `scheme`. The scheme is normalized (lowercased, trimmed, trailing `:` or `://` stripped), so `handle('APP://', ...)` and `handle('app', ...)` are the same registration. Re-registering a scheme **replaces** the previous handler.

The handler returns a `ProtocolResponse` - `data` is the body (a `string` is UTF-8 encoded, a `Uint8Array` is served verbatim) and `mimeType` defaults to `text/html`. Returning `undefined` declines the request (the backend serves a 404-ish empty response).

```ts
import { app, protocol } from 'bunmaska';

// Register BEFORE creating the window that serves app://
protocol.handle('app', (request) => {
  const { pathname } = new URL(request.url);
  if (pathname === '/' || pathname === '/index.html') {
    return { data: '<h1>hello, world</h1>', mimeType: 'text/html' };
  }
  return undefined; // decline -> empty/404-ish response
});

app.whenReady().then(() => {
  // ... new BrowserWindow(...) then loadURL('app://bundle/index.html')
});
```

### `protocol.unhandle(scheme)`

* `scheme` string

Removes the handler registered for `scheme`. No-op if the scheme was not registered.

```ts
import { protocol } from 'bunmaska';

protocol.unhandle('app');
```

### `protocol.isProtocolHandled(scheme)`

* `scheme` string

Returns `boolean` - whether `scheme` currently has a registered handler. The scheme is normalized before lookup.

```ts
import { protocol } from 'bunmaska';

protocol.handle('app', () => ({ data: 'ok' }));
protocol.isProtocolHandled('APP://'); // true
protocol.isProtocolHandled('other');  // false
```

### `protocol.getRegisteredSchemes()`

* Returns `string[]`

Every currently registered scheme, normalized. The native backends iterate this list at web-view creation to wire each scheme onto the platform web view (`setURLSchemeHandler:forURLScheme:` on macOS, `webkit_web_context_register_uri_scheme` on Linux; nothing to wire on Windows, where serving is engine-blocked). Useful in app code mainly to introspect what is registered.

```ts
import { protocol } from 'bunmaska';

protocol.handle('app', () => ({ data: 'ok' }));
protocol.handle('media', () => ({ data: new Uint8Array() }));
protocol.getRegisteredSchemes(); // ['app', 'media']
```

### `protocol.handlerFor(scheme)`

* `scheme` string

Returns the [ProtocolHandler](#types) registered for `scheme`, or `undefined`. The scheme is normalized before lookup. Lower-level than `dispatch` - it hands back the raw handler rather than running it.

```ts
import { protocol } from 'bunmaska';

protocol.handle('app', () => ({ data: 'ok' }));
const handler = protocol.handlerFor('app');
handler?.({ url: 'app://bundle/index.html' }); // { data: 'ok' }
```

### `protocol.dispatch(url)`

* `url` string - a full request URL, e.g. `app://bundle/index.html`.

Returns `{ bytes: Uint8Array; mimeType: string } | undefined`.

The single dispatch entry point both native backends call. It parses the URL's scheme, looks up the handler, runs it, and builds the response (UTF-8 bytes for a string body, the buffer verbatim for a `Uint8Array`, and the resolved MIME type). Returns `undefined` for an unregistered scheme, an unparseable URL, or a handler that declined. You rarely call this directly - it exists so the platform layer (and tests) have one place to serve a request.

```ts
import { protocol } from 'bunmaska';

protocol.handle('app', () => ({ data: '<h1>hi</h1>', mimeType: 'text/html' }));

const built = protocol.dispatch('app://bundle/index.html');
// built?.bytes      -> Uint8Array of the UTF-8 HTML
// built?.mimeType   -> 'text/html'

protocol.dispatch('nope://x'); // undefined (unregistered scheme)
```

### `protocol.clearForTesting()`

* Returns `void`

Clears every registered scheme. Test-only - named so you remember not to ship it in app code.

```ts
import { protocol } from 'bunmaska';

protocol.clearForTesting(); // registry is now empty
```

## Types

Exported alongside `protocol` from `bunmaska`:

```ts
import type {
  ProtocolHandler,
  ProtocolRequest,
  ProtocolResponse,
} from 'bunmaska';

type ProtocolRequest = {
  readonly url: string;
};

type ProtocolResponse = {
  readonly data: string | Uint8Array; // string -> UTF-8; Uint8Array -> verbatim
  readonly mimeType?: string;         // defaults to 'text/html'
};

type ProtocolHandler = (request: ProtocolRequest) => ProtocolResponse | undefined;
```

There is also an exported `DEFAULT_MIME_TYPE` constant (`'text/html'`) on the module, used when a handler omits `mimeType`.

## Not in Bunmaska (yet)

Bunmaska implements the modern `handle`/`unhandle`/`isProtocolHandled` core, but with a simpler handler contract and without the privileged-scheme and interception machinery:

- **Web `Response` handlers** - Electron's `protocol.handle` returns a `Response | Promise<Response>` (and pairs naturally with `net.fetch`). Bunmaska's handler is **synchronous** and returns `{ data, mimeType } | undefined`. No `Promise`, no streaming body, no per-request `status`/`headers` beyond MIME type.
- **`registerSchemesAsPrivileged(customSchemes)`** - not implemented. You cannot declare a scheme as `standard` / `secure` / `bypassCSP` / `supportFetchAPI` / `stream` / etc. Schemes are served as-is by the platform web view.
- **Per-`session` protocol** - there is one global registry; no `session.protocol` / `ses.protocol.handle(...)` and no `partition` targeting. A custom scheme applies to the web views created after it is registered.
- **The deprecated register/intercept family** - `registerFileProtocol`, `registerBufferProtocol`, `registerStringProtocol`, `registerHttpProtocol`, `registerStreamProtocol`, their `intercept*` counterparts, plus `unregisterProtocol` / `uninterceptProtocol` / `isProtocolRegistered` / `isProtocolIntercepted`. Electron itself deprecated these in favor of `handle`, so they are unlikely to return.

Practical consequence: register every custom scheme up front (before any window exists), keep handlers synchronous, and return your bytes via `data` rather than constructing a `Response`.

/**
 * The cross-world DOM bridge that makes `contextBridge.exposeInMainWorld` work
 * after context isolation moved the preload (and `__sambar`) into a separate JS
 * world the page cannot see.
 *
 * Page world ↔ isolated world share the same `document` but have separate
 * globals, so they communicate via `document` CustomEvents (the Chrome
 * content-script pattern). Two scripts cooperate over a per-window random
 * channel id:
 *  - the PAGE-world stub ({@link generatePageWorldStub}), injected into the page
 *    world, materialises `window[key]` whose async methods dispatch request
 *    events and return Promises;
 *  - the ISOLATED-world host ({@link generateIsolatedHostSource}), injected into
 *    the isolated world right after the bootstrap and BEFORE the user preload,
 *    installs `window.__sambar.exposeInMainWorld` (and a `contextBridge` shape).
 *    When the user preload calls it, the host holds the real `api`, answers
 *    request events, and announces each exposed surface to the page stub.
 *
 * SINGLE SOURCE OF TRUTH: the protocol is authored once, as the baked plain-JS
 * strings below. {@link installCrossWorldHost} (the typed, importable surface
 * used by `context-bridge.ts` and the unit tests) runs the SAME baked isolated
 * source via `new Function`, so the TS path and the injected runtime path can
 * never drift.
 *
 * LIMITATIONS (by construction — do not paper over them):
 *  - Exposed functions are ASYNC-ONLY: every method on the page object returns a
 *    Promise, regardless of whether the real handler is synchronous.
 *  - Arguments and return values cross via CustomEvent `detail`, i.e. they are
 *    STRUCTURED-CLONE copied. No functions as arguments, no callbacks, no live
 *    object references, no class instances with behaviour — data only.
 *  - Non-function values on `api` are deep-cloned + deep-frozen into the page
 *    object once at expose time; later mutations on the isolated side are NOT
 *    reflected.
 *  - The DOM channel is page-observable: a hostile page can see the events and
 *    forge requests. This is weaker than Electron's V8-level boundary. The
 *    random channel id only deters accidental collisions, not a determined page.
 */

/** The shared globalThis key the isolated side reads the channel id from. */
export const CHANNEL_GLOBAL_KEY = '__sambarBridgeChannel';

/** Default per-call timeout (ms) before a page-side method rejects. */
export const CROSS_WORLD_CALL_TIMEOUT_MS = 30_000;

/**
 * Generate a per-window random channel id. Used to name the cross-world DOM
 * events so distinct windows (and accidental page listeners) do not collide.
 * Not a security boundary — the page can still observe the events.
 */
export const generateChannelId = (): string =>
  `__sambar_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/**
 * The isolated-world snippet that records the channel id on the isolated global
 * so the host can read it. Injected into the isolated world BEFORE the bridge
 * bootstrap. Plain JS (no TS syntax).
 */
export const generateIsolatedChannelSetup = (channelId: string): string =>
  `globalThis[${JSON.stringify(CHANNEL_GLOBAL_KEY)}] = ${JSON.stringify(channelId)};`;

/** Build the reply-event name paired with a request channel id. */
export const replyChannel = (channelId: string): string => `${channelId}:reply`;

/** Build the page-stub "ready" announce-request event name for a channel id. */
export const readyChannel = (channelId: string): string => `${channelId}:ready`;

/** Build the isolated-side "announce" event name for a channel id. */
export const announceChannel = (channelId: string): string => `${channelId}:announce`;

/**
 * Generate the page-world user-script source that installs the cross-world
 * receiver. It listens for `announce` events (a key, its method names, and its
 * deep-cloned data values) and materialises a deep-frozen `window[key]` whose
 * methods are async proxies over the DOM channel.
 *
 * Resilience: it re-emits `ready` on the next microtask AND a later macrotask so
 * the host (re)announces regardless of which script's listener attached first;
 * the host also retains its surfaces and replies to EVERY `ready`. The target is
 * built with `Object.create(null)` and `Object.defineProperty` to neutralise
 * `__proto__`/`constructor` traps, and a per-call timeout rejects stalled calls.
 *
 * `channelId` is baked in at inject time and must match the isolated host's id.
 * Authored as plain JS (no TS syntax) so it reaches the page engine verbatim.
 */
export const generatePageWorldStub = (channelId: string): string => {
  const REQ = JSON.stringify(channelId);
  const REPLY = JSON.stringify(replyChannel(channelId));
  const READY = JSON.stringify(readyChannel(channelId));
  const ANNOUNCE = JSON.stringify(announceChannel(channelId));
  const TIMEOUT = String(CROSS_WORLD_CALL_TIMEOUT_MS);
  return `(function () {
  var doc = document;
  var nextCallId = 1;
  var pending = new Map();

  doc.addEventListener(${REPLY}, function (e) {
    var detail = e.detail || {};
    var slot = pending.get(detail.callId);
    if (!slot) {
      return;
    }
    pending.delete(detail.callId);
    if (slot.timer) {
      clearTimeout(slot.timer);
    }
    if (detail.ok === true) {
      slot.resolve(detail.result);
    } else {
      slot.reject(new Error(detail.error || 'contextBridge call failed'));
    }
  });

  function makeMethod(key, method) {
    return function () {
      var args = Array.prototype.slice.call(arguments);
      var callId = nextCallId;
      nextCallId += 1;
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          if (pending.has(callId)) {
            pending.delete(callId);
            reject(
              new Error('contextBridge call ' + key + '.' + method + ' timed out')
            );
          }
        }, ${TIMEOUT});
        pending.set(callId, { resolve: resolve, reject: reject, timer: timer });
        doc.dispatchEvent(
          new CustomEvent(${REQ}, {
            detail: { callId: callId, key: key, method: method, args: args },
          })
        );
      });
    };
  }

  function deepFreeze(value) {
    if (value === null || typeof value !== 'object') {
      return value;
    }
    var names = Object.getOwnPropertyNames(value);
    for (var i = 0; i < names.length; i += 1) {
      deepFreeze(value[names[i]]);
    }
    return Object.freeze(value);
  }

  function materialise(detail) {
    var key = detail.key;
    if (Object.prototype.hasOwnProperty.call(window, key)) {
      return;
    }
    var target = Object.create(null);
    var methods = detail.methods || [];
    for (var i = 0; i < methods.length; i += 1) {
      Object.defineProperty(target, methods[i], {
        value: makeMethod(key, methods[i]),
        writable: false,
        configurable: false,
        enumerable: true,
      });
    }
    var values = detail.values || {};
    var valueKeys = Object.keys(values);
    for (var j = 0; j < valueKeys.length; j += 1) {
      Object.defineProperty(target, valueKeys[j], {
        value: deepFreeze(values[valueKeys[j]]),
        writable: false,
        configurable: false,
        enumerable: true,
      });
    }
    Object.defineProperty(window, key, {
      value: Object.freeze(target),
      writable: false,
      configurable: false,
      enumerable: true,
    });
  }

  doc.addEventListener(${ANNOUNCE}, function (e) {
    materialise(e.detail || {});
  });

  function ready() {
    doc.dispatchEvent(new CustomEvent(${READY}));
  }

  // Tell the isolated host the page is ready so it can (re)announce. Emit now,
  // on a microtask, and on a later macrotask so the host materialises the
  // surface no matter which script's listener attached first.
  ready();
  Promise.resolve().then(ready);
  setTimeout(ready, 0);
})();`;
};

/**
 * Generate the ISOLATED-world host source. Injected into the isolated world
 * right after the bootstrap and BEFORE the user preload, so the user preload can
 * call `window.__sambar.exposeInMainWorld(key, api)` (also reachable as
 * `contextBridge.exposeInMainWorld`).
 *
 * For each exposed surface it: registers the real handlers, answers page-world
 * request events for `key`, and RETAINS the announced surface so it replies to
 * EVERY page `ready` (resilient handshake — the page materialises regardless of
 * script ordering). It announces both immediately and on every `ready`.
 *
 * This is the CANONICAL protocol implementation. {@link installCrossWorldHost}
 * runs this exact source via `new Function`, so there is one source of truth.
 *
 * Authored as plain JS (no TS syntax) so it reaches the isolated engine verbatim.
 */
export const generateIsolatedHostSource = (channelId: string): string => {
  const REQ = JSON.stringify(channelId);
  const REPLY = JSON.stringify(replyChannel(channelId));
  const READY = JSON.stringify(readyChannel(channelId));
  const ANNOUNCE = JSON.stringify(announceChannel(channelId));
  return `(function () {
  var g = globalThis;
  var doc = document;
  var CE = g.CustomEvent;

  function clone(value) {
    if (typeof g.structuredClone === 'function') {
      return g.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  // Registry of exposed surfaces: key -> { api, methods, values }.
  var surfaces = new Map();

  function announceOne(entry) {
    doc.dispatchEvent(
      new CE(${ANNOUNCE}, {
        detail: { key: entry.key, methods: entry.methods, values: clone(entry.values) },
      })
    );
  }

  function announceAll() {
    surfaces.forEach(function (entry) {
      announceOne(entry);
    });
  }

  // Reply to EVERY page ready (resilient handshake): re-announce every surface.
  doc.addEventListener(${READY}, announceAll);

  // Single request listener routes by key across all exposed surfaces.
  doc.addEventListener(${REQ}, function (e) {
    var detail = e.detail || {};
    var entry = surfaces.get(detail.key);
    function reply(payload) {
      doc.dispatchEvent(new CE(${REPLY}, { detail: payload }));
    }
    if (!entry) {
      return;
    }
    var handler = entry.api[detail.method];
    if (typeof handler !== 'function') {
      reply({
        callId: detail.callId,
        ok: false,
        error: 'contextBridge: no method "' + detail.method + '"',
      });
      return;
    }
    Promise.resolve()
      .then(function () {
        return handler.apply(entry.api, detail.args || []);
      })
      .then(function (result) {
        reply({ callId: detail.callId, ok: true, result: clone(result) });
      })
      .catch(function (error) {
        reply({
          callId: detail.callId,
          ok: false,
          error: error && error.message ? error.message : String(error),
        });
      });
  });

  function expose(key, api) {
    if (surfaces.has(key)) {
      throw new Error('contextBridge: "' + key + '" is already defined in the main world');
    }
    var methods = [];
    var values = {};
    var names = Object.keys(api);
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i];
      if (typeof api[name] === 'function') {
        methods.push(name);
      } else {
        values[name] = clone(api[name]);
      }
    }
    var entry = { key: key, api: api, methods: methods, values: values };
    surfaces.set(key, entry);
    // Announce now in case the page stub is already listening; the ready handler
    // covers the page-arrives-later ordering.
    announceOne(entry);
  }

  if (!g.__sambar) {
    g.__sambar = {};
  }
  g.__sambar.exposeInMainWorld = expose;
  if (!g.contextBridge) {
    g.contextBridge = {};
  }
  g.contextBridge.exposeInMainWorld = expose;
})();`;
};

/** A DOM-event-bearing object the isolated host can attach to (the document). */
export type EventScope = {
  addEventListener(type: string, listener: (event: { detail?: unknown }) => void): void;
  dispatchEvent(event: { type: string; detail?: unknown }): boolean;
};

/** Minimal CustomEvent constructor shape, satisfied by the DOM's global. */
export type CustomEventCtor = new (
  type: string,
  init?: { detail?: unknown },
) => { type: string; detail?: unknown };

/** The `exposeInMainWorld` function the isolated host installs. */
type ExposeFn = (key: string, api: Record<string, unknown>) => void;

/**
 * Install the ISOLATED-world host over an injected `scope` (the shared
 * `document`) + `CustomEventImpl` and return its `exposeInMainWorld`.
 *
 * This runs the CANONICAL {@link generateIsolatedHostSource} via `new Function`
 * against a synthetic global, so the typed/importable path executes byte-for-byte
 * the SAME protocol code that is baked and injected into the isolated world —
 * there is no second implementation to drift.
 *
 * The synthetic global proxies `document`/`CustomEvent` to the supplied
 * `scope`/`CustomEventImpl` and inherits `structuredClone`, `Map`, `Object`,
 * `Promise`, `Array`, `JSON`, `String` from the host realm.
 */
export const installCrossWorldHost = (
  channelId: string,
  scope: EventScope,
  CustomEventImpl: CustomEventCtor,
): ExposeFn => {
  const fakeGlobal: Record<string, unknown> = {
    CustomEvent: CustomEventImpl,
    structuredClone: (globalThis as { structuredClone?: unknown }).structuredClone,
    Map,
    Object,
    Promise,
    Array,
    JSON,
    String,
  };
  const factory = new Function(
    'globalThis',
    'document',
    `${generateIsolatedHostSource(channelId)}\nreturn globalThis.__sambar.exposeInMainWorld;`,
  ) as (g: Record<string, unknown>, doc: EventScope) => ExposeFn;
  return factory(fakeGlobal, scope);
};

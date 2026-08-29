/**
 * The cross-world DOM bridge behind `contextBridge.exposeInMainWorld`.
 *
 * Page world and isolated world share one `document` but have separate globals, so
 * they talk over `document` CustomEvents on a per-window random channel id: the
 * page-world stub ({@link generatePageWorldStub}) materialises `window[key]` with
 * async proxy methods; the isolated-world host ({@link generateIsolatedHostSource})
 * holds the real `api` and answers those request events.
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
export const CHANNEL_GLOBAL_KEY = '__bunmaskaBridgeChannel';

/** Default per-call timeout (ms) before a page-side method rejects. */
export const CROSS_WORLD_CALL_TIMEOUT_MS = 30_000;

/**
 * A per-window random channel id naming the cross-world DOM events. Not a security
 * boundary — the page can still observe them; it only prevents collisions.
 */
export const generateChannelId = (): string =>
  `__bunmaska_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/**
 * The isolated-world snippet recording the channel id on the isolated global.
 * Injected into the isolated world BEFORE the bridge bootstrap.
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
 * The page-world script that materialises a deep-frozen `window[key]` from an
 * `announce` event, its methods async proxies over the DOM channel.
 *
 * It re-emits `ready` now, on a microtask, AND on a later macrotask, and the host
 * replies to EVERY `ready`, so the surface materialises regardless of which
 * script's listener attached first. The target is built with `Object.create(null)`
 * + `Object.defineProperty` to neutralise `__proto__`/`constructor` traps, and a
 * per-call timeout rejects stalled calls. `channelId` must match the host's.
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
 * The ISOLATED-world host, injected right after the bootstrap and BEFORE the user
 * preload so the preload can call `window.__bunmaska.exposeInMainWorld(key, api)`.
 * It RETAINS every announced surface and re-announces on every page `ready`, so the
 * page materialises regardless of script ordering.
 *
 * This is the CANONICAL protocol implementation; {@link installCrossWorldHost} runs
 * this exact source via `new Function`.
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
    var seen = Object.create(null);
    var names = Object.keys(api);
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i];
      // Reject prototype-pollution member names that would corrupt the page
      // target built via Object.defineProperty / the announce payload.
      if (name === '__proto__' || name === 'constructor' || name === 'prototype') {
        throw new Error('contextBridge: member name "' + name + '" is not allowed');
      }
      // Defensive collision check (Object.keys dedupes own keys, but guard so a
      // future merge of multiple sources cannot silently shadow a member).
      if (seen[name]) {
        throw new Error('contextBridge: member "' + name + '" is defined more than once');
      }
      seen[name] = true;
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

  if (!g.__bunmaska) {
    g.__bunmaska = {};
  }
  g.__bunmaska.exposeInMainWorld = expose;
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
 * Install the ISOLATED-world host over an injected `scope` (the shared `document`)
 * + `CustomEventImpl` and return its `exposeInMainWorld`. Runs the canonical
 * {@link generateIsolatedHostSource} via `new Function` against a synthetic global
 * that proxies `document`/`CustomEvent` and inherits `structuredClone`, `Map`,
 * `Object`, `Promise`, `Array`, `JSON`, `String` from the host realm.
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
    `${generateIsolatedHostSource(channelId)}\nreturn globalThis.__bunmaska.exposeInMainWorld;`,
  ) as (g: Record<string, unknown>, doc: EventScope) => ExposeFn;
  return factory(fakeGlobal, scope);
};

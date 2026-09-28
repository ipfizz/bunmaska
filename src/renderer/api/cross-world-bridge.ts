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
 *    object references, no class instances with behaviour — data only. A call
 *    with uncloneable arguments rejects before it is sent.
 *  - `api` must be an object. Only its own top-level functions become methods;
 *    a nested function is rejected and an inherited one is never callable.
 *  - Non-function values on `api` are deep-cloned + deep-frozen into the page
 *    object once at expose time; later mutations on the isolated side are NOT
 *    reflected.
 *  - The DOM channel is page-observable: a hostile page can see the events and
 *    forge requests. This is weaker than Electron's V8-level boundary. The
 *    random channel id only deters accidental collisions, not a determined page.
 */

/** The shared globalThis key the isolated side reads the channel id from. */
export const CHANNEL_GLOBAL_KEY = '__bunmaskaBridgeChannel';

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
 * + `Object.defineProperty` to neutralise `__proto__`/`constructor` traps. Calls
 * have no timeout (as in Electron). `channelId` must match the host's.
 */
export const generatePageWorldStub = (channelId: string): string => {
  const REQ = JSON.stringify(channelId);
  const REPLY = JSON.stringify(replyChannel(channelId));
  const READY = JSON.stringify(readyChannel(channelId));
  const ANNOUNCE = JSON.stringify(announceChannel(channelId));
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
    if (detail.ok === true) {
      slot.resolve(detail.result);
    } else {
      slot.reject(new Error(detail.error || 'contextBridge call failed'));
    }
  });

  function makeMethod(key, method) {
    return function () {
      var args = Array.prototype.slice.call(arguments);
      // An uncloneable detail reaches the host as null and is never answered.
      try {
        structuredClone(args);
      } catch (error) {
        return Promise.reject(
          new Error(
            'contextBridge call ' + key + '.' + method +
              ': arguments must be structured-cloneable (no functions or DOM nodes): ' +
              error.message
          )
        );
      }
      var callId = nextCallId;
      nextCallId += 1;
      return new Promise(function (resolve, reject) {
        pending.set(callId, { resolve: resolve, reject: reject });
        doc.dispatchEvent(
          new CustomEvent(${REQ}, {
            detail: { callId: callId, key: key, method: method, args: args },
          })
        );
      });
    };
  }

  // Freeze before recursing so a cycle terminates; typed arrays cannot be frozen.
  function deepFreeze(value) {
    if (
      value === null ||
      typeof value !== 'object' ||
      Object.isFrozen(value) ||
      ArrayBuffer.isView(value)
    ) {
      return value;
    }
    Object.freeze(value);
    var names = Object.getOwnPropertyNames(value);
    for (var i = 0; i < names.length; i += 1) {
      deepFreeze(value[names[i]]);
    }
    return value;
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
    if (entry.methods.indexOf(detail.method) === -1) {
      reply({
        callId: detail.callId,
        ok: false,
        error: 'contextBridge: no method "' + detail.method + '"',
      });
      return;
    }
    Promise.resolve()
      .then(function () {
        return entry.api[detail.method].apply(entry.api, detail.args || []);
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
    if (api === null || typeof api !== 'object' || Array.isArray(api)) {
      throw new Error('contextBridge: the api exposed as "' + key + '" must be an object');
    }
    if (surfaces.has(key)) {
      throw new Error('contextBridge: "' + key + '" is already defined in the main world');
    }
    var methods = [];
    var values = {};
    var names = Object.keys(api);
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i];
      // Reject prototype-pollution member names that would corrupt the page
      // target built via Object.defineProperty / the announce payload.
      if (name === '__proto__' || name === 'constructor' || name === 'prototype') {
        throw new Error('contextBridge: member name "' + name + '" is not allowed');
      }
      if (typeof api[name] === 'function') {
        methods.push(name);
      } else {
        try {
          values[name] = clone(api[name]);
        } catch (error) {
          throw new Error(
            'contextBridge: member "' + name + '" must be a function or cloneable data ' +
              '(nested functions are not supported; make them top-level methods): ' +
              error.message
          );
        }
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

/** Run the canonical host source over `scope`; returns its `exposeInMainWorld`. */
export const installCrossWorldHost = (
  channelId: string,
  scope: EventScope,
  CustomEventImpl: CustomEventCtor,
): ExposeFn => {
  const fakeGlobal: Record<string, unknown> = {
    CustomEvent: CustomEventImpl,
    structuredClone: globalThis.structuredClone,
  };
  const factory = new Function(
    'globalThis',
    'document',
    `${generateIsolatedHostSource(channelId)}\nreturn globalThis.__bunmaska.exposeInMainWorld;`,
  ) as (g: Record<string, unknown>, doc: EventScope) => ExposeFn;
  return factory(fakeGlobal, scope);
};

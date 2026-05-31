/**
 * Generates the preload bootstrap — a self-contained JavaScript string injected
 * into every page before its own scripts run (via `WKUserScript` at
 * `documentStart` on macOS).
 *
 * The bootstrap installs `globalThis.__sambar`, the low-level bridge that
 * `ipcRenderer` / `contextBridge` build on:
 * - `send(channel, ...args)` posts a `send` envelope to main.
 * - `invoke(channel, ...args)` posts an `invoke` envelope and returns a Promise
 *   settled by the matching `reply` (correlated by a monotonic id).
 * - `on(channel, listener)` registers a handler for `send` envelopes from main.
 * - `_dispatch(rawJson)` is called by main (via `evaluateJavaScript`) to deliver
 *   inbound envelopes.
 *
 * Transport: renderer→main uses `window.webkit.messageHandlers.sambar.postMessage`
 * (the `WKScriptMessageHandler` registered by the backend); main→renderer calls
 * `__sambar._dispatch(...)` through `evaluateJavaScript`.
 *
 * Authored as a plain-JS string (not a stringified TS function) so the exact
 * text we wrote reaches the page's JS engine with no transpilation in between.
 * A test asserts the output contains no TypeScript syntax.
 */

const BOOTSTRAP_SOURCE = `(function () {
  var g = globalThis;
  var channel =
    g.webkit && g.webkit.messageHandlers && g.webkit.messageHandlers.sambar
      ? g.webkit.messageHandlers.sambar
      : null;

  function post(envelope) {
    if (channel) {
      channel.postMessage(JSON.stringify(envelope));
    }
  }

  var nextId = 1;
  var pending = new Map();
  var listeners = new Map();

  var sambar = {
    send: function (ch) {
      var args = Array.prototype.slice.call(arguments, 1);
      post({ kind: 'send', channel: ch, args: args });
    },
    invoke: function (ch) {
      var args = Array.prototype.slice.call(arguments, 1);
      var id = nextId;
      nextId += 1;
      return new Promise(function (resolve, reject) {
        pending.set(id, { resolve: resolve, reject: reject });
        post({ kind: 'invoke', id: id, channel: ch, args: args });
      });
    },
    on: function (ch, listener) {
      var list = listeners.get(ch) || [];
      list.push({ fn: listener, once: false });
      listeners.set(ch, list);
    },
    once: function (ch, listener) {
      var list = listeners.get(ch) || [];
      list.push({ fn: listener, once: true });
      listeners.set(ch, list);
    },
    removeListener: function (ch, listener) {
      var list = listeners.get(ch);
      if (!list) {
        return;
      }
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].fn === listener) {
          list.splice(i, 1);
          return;
        }
      }
    },
    removeAllListeners: function (ch) {
      if (ch === undefined) {
        listeners.clear();
      } else {
        listeners.delete(ch);
      }
    },
    _dispatch: function (raw) {
      var env = JSON.parse(raw);
      if (env.kind === 'reply' && typeof env.id === 'number') {
        var slot = pending.get(env.id);
        if (slot) {
          pending.delete(env.id);
          if (env.ok === true) {
            slot.resolve(env.result);
          } else {
            slot.reject(new Error(env.error || 'IPC invoke failed'));
          }
        }
        return;
      }
      if (env.kind === 'send' && typeof env.channel === 'string') {
        var live = listeners.get(env.channel) || [];
        // Snapshot so listeners added during dispatch are not invoked this round.
        var snapshot = live.slice();
        var args = env.args || [];
        for (var i = 0; i < snapshot.length; i += 1) {
          var record = snapshot[i];
          var current = listeners.get(env.channel) || [];
          // Skip records removed (by removeListener/removeAllListeners) earlier
          // in this same dispatch.
          if (current.indexOf(record) === -1) {
            continue;
          }
          // once-listeners are removed BEFORE firing so a re-entrant dispatch
          // cannot invoke them a second time.
          if (record.once) {
            current.splice(current.indexOf(record), 1);
          }
          record.fn.apply(null, args);
        }
      }
    },
  };

  g.__sambar = sambar;
})();`;

/** Return the preload bootstrap as an injectable plain-JavaScript string. */
export const generatePreloadBootstrap = (): string => BOOTSTRAP_SOURCE;

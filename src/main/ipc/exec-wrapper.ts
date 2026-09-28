/** How long `executeJavaScript` waits for its out-of-band result, on every backend. */
export const EXEC_TIMEOUT_MS = 120_000;

/**
 * The page-world wrapper for `executeJavaScript`. It posts `{ execId, ok, result | error }` as
 * JSON to `handlerName` so every backend shares one out-of-band path. Indirect `(0, eval)`
 * resolves a bare expression to its completion value, as Electron.
 */
export const buildExecWrapper = (execId: number, handlerName: string, code: string): string => {
  const id = JSON.stringify(execId);
  const name = JSON.stringify(handlerName);
  const src = JSON.stringify(code);
  return `(function(){
  var __msg = function(e){
    try { return String((e && e.message) || e); } catch (x) { return 'non-printable error'; }
  };
  var __post = function(payload){
    var json;
    try { json = JSON.stringify(payload); } catch (e) {
      json = JSON.stringify({ execId: ${id}, ok: false, error: 'result is not JSON-serializable: ' + __msg(e) });
    }
    try { window.webkit.messageHandlers[${name}].postMessage(json); } catch (e) {}
  };
  try {
    Promise.resolve((0, eval)(${src})).then(
      function(v){ __post({ execId: ${id}, ok: true, result: v }); },
      function(e){ __post({ execId: ${id}, ok: false, error: __msg(e) }); }
    );
  } catch (e) {
    __post({ execId: ${id}, ok: false, error: __msg(e) });
  }
})();`;
};

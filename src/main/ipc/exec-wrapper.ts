/**
 * Builds the page-world wrapper script for `WebContents.executeJavaScript`.
 *
 * On every backend the completion handler cannot be passed to the native
 * `evaluateJavaScript` call (a real Objective-C block crashes Bun on macOS, D022;
 * a per-call `GAsyncReadyCallback` JSCallback is closed mid-invocation on Linux,
 * freeing its trampoline), so the result comes back out-of-band: the wrapper posts
 * `{ execId, ok, result?, error? }` as JSON to the `handlerName` message handler,
 * and only JSON-serializable results survive.
 *
 * User code runs via indirect `(0, eval)` so a bare expression resolves to its
 * completion value, matching Electron.
 */
/**
 * How long `executeJavaScript` waits for its out-of-band result before rejecting.
 * Generous (2 min) and identical on every backend, so long in-page work is not
 * cut off.
 */
export const EXEC_TIMEOUT_MS = 120_000;

export const buildExecWrapper = (execId: number, handlerName: string, code: string): string => {
  const id = JSON.stringify(execId);
  const name = JSON.stringify(handlerName);
  const src = JSON.stringify(code);
  return `(function(){
  var __post = function(payload){
    try { window.webkit.messageHandlers[${name}].postMessage(JSON.stringify(payload)); } catch (e) {}
  };
  try {
    Promise.resolve((0, eval)(${src})).then(
      function(v){ __post({ execId: ${id}, ok: true, result: v }); },
      function(e){ __post({ execId: ${id}, ok: false, error: String((e && e.message) || e) }); }
    );
  } catch (e) {
    __post({ execId: ${id}, ok: false, error: String((e && e.message) || e) });
  }
})();`;
};

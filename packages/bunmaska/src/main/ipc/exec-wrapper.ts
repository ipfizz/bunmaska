/**
 * Builds the page-world wrapper script for `WebContents.executeJavaScript`.
 *
 * On both backends the completion handler cannot be passed to the native
 * `evaluateJavaScript` call (a real Objective-C block crashes Bun on macOS,
 * D022; a per-call `GAsyncReadyCallback` JSCallback is closed mid-invocation on
 * Linux, freeing its trampoline), so the result is returned out-of-band: the
 * wrapper runs the user code and posts the outcome to a page-world
 * `WKScriptMessageHandler` / `WebKitUserContentManager` handler named
 * `handlerName`.
 *
 * User code is evaluated via indirect `(0, eval)(code)` so a bare expression
 * resolves to its completion value — matching Electron, where the evaluated
 * string's last expression value is returned. The user code is JSON-encoded into
 * the wrapper, so any quotes/newlines/backslashes round-trip safely. The result
 * is wrapped in `Promise.resolve` so a thenable result resolves to its value.
 *
 * The posted payload is `{ execId, ok, result?, error? }` as a JSON string. Only
 * JSON-serializable results survive (`JSON.stringify` semantics, e.g. a function
 * result serializes to `undefined`).
 */
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

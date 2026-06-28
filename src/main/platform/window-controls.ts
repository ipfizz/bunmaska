/**
 * The built-in page-world script for custom (frameless) title bars — Bunmaska's
 * cross-platform answer to Electron's `-webkit-app-region`. Every platform backend
 * injects it into the page world. It does up to three things:
 *
 *  1. (Native-op-channel platforms only — see `nativeOpChannel`.) Exposes
 *     `window.__bunmaska.window` controls (minimize / maximize / close / …) that
 *     post `{ op }` to the native `bunmaskaWindow` message handler, plus a
 *     left-mousedown drag over a `--app-region: drag` region. This is GATED: on a
 *     platform with a real isolated world (macOS/Linux) the page world must NOT
 *     carry a `__bunmaska` handle — that would defeat context isolation — so the
 *     controls belong on the isolated-world bridge (a follow-up), not here. Only
 *     Windows, whose bridge already lives in the page world, opts in.
 *  2. MIRRORS `--app-region` onto the native `-webkit-app-region`, which macOS
 *     WKWebView honors for window dragging out of the box. Custom properties
 *     inherit, so `--app-region: drag` on a bar + `--app-region: no-drag` on its
 *     buttons gives exactly Electron's app-region cascade. On engines that ignore
 *     `-webkit-app-region` (WinCairo, WebKitGTK) the mirror is a harmless no-op and
 *     the drag goes through the native window-op handler (1) instead.
 *
 * The mirror re-runs on DOM mutations (debounced to one pass per frame). It only
 * observes structural changes, not the `style` attribute it writes, so it can't loop.
 */
export const WINDOW_HANDLER_NAME = 'bunmaskaWindow';

/**
 * Build the page-world title-bar script. Pass `nativeOpChannel: true` ONLY where the
 * page world IS the bridge world (Windows, which has no separate isolated world), so
 * `window.__bunmaska.window` extends the real bridge and the JS drag fallback can post
 * to the `bunmaskaWindow` handler. Leave it false on isolated-world platforms
 * (macOS/Linux) to keep the page world free of any `__bunmaska` handle — there only the
 * `--app-region` mirror runs, and macOS drags natively off it.
 */
export function windowControlsScript(options: { nativeOpChannel?: boolean } = {}): string {
  const ops = options.nativeOpChannel
    ? `  var post = function(op){
    try { window.webkit.messageHandlers.${WINDOW_HANDLER_NAME}.postMessage(JSON.stringify({ op: op })); } catch (e) {}
  };
  var b = (window.__bunmaska = window.__bunmaska || {});
  b.window = {
    minimize: function(){ post('minimize'); },
    maximize: function(){ post('maximize'); },
    unmaximize: function(){ post('unmaximize'); },
    toggleMaximize: function(){ post('toggleMaximize'); },
    close: function(){ post('close'); },
    startDrag: function(){ post('drag'); }
  };
  document.addEventListener('mousedown', function(e){
    if (e.button !== 0) return;
    var n = e.target;
    var el = n && n.nodeType === 1 ? n : (n && n.parentElement);
    if (!el) return;
    if (getComputedStyle(el).getPropertyValue('--app-region').trim() === 'drag') {
      e.preventDefault();
      post('drag');
    }
  }, true);
`
    : '';
  return `(function(){
${ops}  var mirror = function(){
    try {
      var els = document.querySelectorAll('*');
      for (var i = 0; i < els.length; i++) {
        var v = getComputedStyle(els[i]).getPropertyValue('--app-region').trim();
        if (v === 'drag' || v === 'no-drag') els[i].style.setProperty('-webkit-app-region', v);
      }
    } catch (e) {}
  };
  var pending = false;
  var schedule = function(){
    if (pending) return;
    pending = true;
    requestAnimationFrame(function(){ pending = false; mirror(); });
  };
  if (document.readyState !== 'loading') schedule();
  document.addEventListener('DOMContentLoaded', schedule);
  try {
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();`;
}

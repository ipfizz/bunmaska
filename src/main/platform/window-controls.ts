/**
 * The built-in page-world script for custom (frameless) title bars. It does up to
 * two things:
 *
 *  1. (Native-op-channel platforms only.) Exposes `window.__bunmaska.window`
 *     controls that post `{ op }` to the `bunmaskaWindow` message handler. GATED:
 *     on a platform with a real isolated world (macOS/Linux) the page world must
 *     NOT carry a `__bunmaska` handle — that would defeat context isolation. Only
 *     Windows, whose bridge already lives in the page world, opts in.
 *  2. MIRRORS `--app-region` onto `-webkit-app-region`, which macOS WKWebView
 *     honors for window dragging; custom properties inherit, giving Electron's
 *     app-region cascade. Engines that ignore it (WinCairo, WebKitGTK) fall back
 *     to the native window-op handler in (1).
 *
 * The mirror observes structural changes only, not the `style` attribute it writes,
 * so it cannot loop.
 */
export const WINDOW_HANDLER_NAME = 'bunmaskaWindow';

/**
 * Build the page-world title-bar script. Pass `nativeOpChannel: true` ONLY where the
 * page world IS the bridge world (Windows, which has no separate isolated world);
 * on macOS/Linux it must stay false so the page world carries no `__bunmaska`
 * handle, leaving only the `--app-region` mirror macOS drags natively off.
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

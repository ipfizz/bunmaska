/**
 * The built-in page-world script for custom (frameless) title bars — Bunmaska's
 * cross-platform answer to Electron's `-webkit-app-region`, injected by every
 * platform backend. It does three things:
 *
 *  1. Exposes `window.__bunmaska.window` controls (minimize / maximize / close / …)
 *     that post `{ op }` to the native `bunmaskaWindow` message handler.
 *  2. Auto-starts a window drag on a left-button mousedown over a region whose CSS
 *     custom property `--app-region` resolves to `drag`. Custom properties inherit,
 *     so `--app-region: drag` on a bar + `--app-region: no-drag` on its buttons gives
 *     exactly Electron's app-region cascade.
 *  3. MIRRORS `--app-region` onto the native `-webkit-app-region`, which macOS
 *     WKWebView honors for window dragging out of the box. On engines that ignore
 *     `-webkit-app-region` (WinCairo, WebKitGTK) the mirror is a harmless no-op and
 *     the drag goes through the native window-op handler (1)/(2) instead.
 *
 * The op handler is wired per platform: Windows routes it to the Win32 window today;
 * macOS drags natively via the mirror; macOS/Linux control handlers are a follow-up.
 *
 * The mirror re-runs on DOM mutations (debounced to one pass per frame). It only
 * observes structural changes, not the `style` attribute it writes, so it can't loop.
 */
export const WINDOW_HANDLER_NAME = 'bunmaskaWindow';

export const WINDOW_CONTROLS_SCRIPT = `(function(){
  var post = function(op){
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
  var mirror = function(){
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
})();`;

// Frameless title bars (D045): mirrors `--app-region` onto `-webkit-app-region`, which only
// macOS WKWebView drags off. The mirror never observes the `style` attribute it writes, so it
// cannot loop. ponytail: no Linux drag yet, wire gdk_toplevel_begin_move via the isolated bridge.
export const WINDOW_HANDLER_NAME = 'bunmaskaWindow';

/**
 * `nativeOpChannel` adds `window.__bunmaska.window` controls and a mousedown drag. Pass it ONLY
 * where the page world IS the bridge world (Windows): on macOS/Linux a page-world `__bunmaska`
 * would defeat context isolation.
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
${ops}  var mirrored = new WeakSet();
  var mirror = function(){
    try {
      var els = document.querySelectorAll('*');
      for (var i = 0; i < els.length; i++) {
        var v = getComputedStyle(els[i]).getPropertyValue('--app-region').trim();
        if (v === 'drag' || v === 'no-drag') {
          els[i].style.setProperty('-webkit-app-region', v);
          mirrored.add(els[i]);
        } else if (mirrored.has(els[i])) {
          els[i].style.removeProperty('-webkit-app-region');
          mirrored.delete(els[i]);
        }
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
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
  } catch (e) {}
})();`;
}

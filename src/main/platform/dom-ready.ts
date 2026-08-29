/**
 * Page-world `dom-ready` injection: no native delegate reports DOMContentLoaded, so
 * a page-world script posts to a dedicated script-message handler that the backend
 * routes to a `dom-ready` navigation event. Every backend injects this same script.
 */

/** The page-world script-message handler name the dom-ready script posts to. */
export const DOM_READY_HANDLER_NAME = 'bunmaskaDomReady';

/** The page-world script that fires once the document is ready. */
export const generateDomReadyScript = (): string =>
  `(() => {
    const post = () => {
      try {
        window.webkit.messageHandlers.${DOM_READY_HANDLER_NAME}.postMessage('');
      } catch {}
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', post, { once: true });
    } else {
      post();
    }
  })();`;

/**
 * Page-world `dom-ready` injection (Electron's `webContents` `dom-ready`).
 *
 * No native delegate reports DOMContentLoaded, so a tiny page-world script posts
 * to a dedicated script-message handler when the document is ready; the backend
 * routes that to a `dom-ready` navigation event. Platform-neutral (just a JS
 * string + the shared handler name) so both backends inject the same script.
 */

/** The page-world script-message handler name the dom-ready script posts to. */
export const DOM_READY_HANDLER_NAME = 'sambarDomReady';

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

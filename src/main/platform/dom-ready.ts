// No native delegate reports DOMContentLoaded, so every backend injects this
// script; it posts for the main frame only, as Electron's `dom-ready` does.
export const DOM_READY_HANDLER_NAME = 'bunmaskaDomReady';

export const generateDomReadyScript = (): string =>
  `(() => {
    if (window !== window.top) {
      return;
    }
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

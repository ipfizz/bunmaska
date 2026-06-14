/**
 * Renderer-side `webFrame` — the drop-in equivalent of Electron's `webFrame`.
 *
 * Pure renderer JS that runs inside the page's isolated world (which shares the
 * DOM with the page), so `insertCSS`/zoom mutations affect the visible page.
 *
 * LIMITATIONS / HONESTY:
 *  - Zoom is implemented via WebKit's non-standard CSS `zoom` on the document
 *    element — a close approximation of Electron's native page zoom, NOT the
 *    native WKWebView magnification (macOS) or WebKitGTK `zoom_level` (Linux).
 *    A native-backed zoom (driven over the main process) could be a later
 *    enhancement; this renderer-local version is layout-zoom only.
 *  - `executeJavaScript` evaluates in the renderer's CURRENT world only (the
 *    caller's world, matching Electron), via indirect global `eval`. It is NOT
 *    the main-side `WebContents.executeJavaScript`.
 */

/** Minimal element surface webFrame touches (no DOM lib in this project). */
export type WebFrameElement = {
  textContent: string;
  readonly style: { zoom: string };
  setAttribute(name: string, value: string): void;
  appendChild(child: WebFrameElement): void;
  removeChild(child: WebFrameElement): void;
};

/** Minimal `document` surface webFrame touches. */
export type WebFrameDocument = {
  readonly documentElement: WebFrameElement;
  readonly head?: WebFrameElement;
  createElement(tagName: string): WebFrameElement;
};

/** Injectable scope, overridable in tests. Defaults to the real globals. */
export type WebFrameScope = {
  readonly document?: WebFrameDocument;
  readonly globalThis?: object;
};

export type WebFrame = {
  executeJavaScript(code: string): Promise<unknown>;
  insertCSS(css: string): string;
  removeInsertedCSS(key: string): void;
  setZoomFactor(factor: number): void;
  getZoomFactor(): number;
  setZoomLevel(level: number): void;
  getZoomLevel(): number;
};

/** Electron's zoom relation: a one-level step multiplies the factor by 1.2. */
const ZOOM_STEP = 1.2;

type EvalFn = (code: string) => unknown;

const resolveDocument = (override?: WebFrameDocument): WebFrameDocument | undefined =>
  override ?? (Reflect.get(globalThis, 'document') as WebFrameDocument | undefined);

const resolveGlobal = (override?: object): object => override ?? globalThis;

/**
 * Create the `webFrame` object. Pass a {@link WebFrameScope} to drive it over a
 * mock `document`/`globalThis` in tests; in a real renderer it auto-resolves
 * the page's `document` and global `eval` from the current world's globals.
 */
export const createWebFrame = (scope?: WebFrameScope): WebFrame => {
  const inserted = new Map<string, WebFrameElement>();
  let counter = 0;

  const getDocument = (): WebFrameDocument => {
    const doc = resolveDocument(scope?.document);
    if (doc === undefined) {
      throw new Error('webFrame: no document is available in the current renderer world');
    }
    return doc;
  };

  return {
    executeJavaScript(code) {
      try {
        const indirectEval = Reflect.get(resolveGlobal(scope?.globalThis), 'eval') as EvalFn;
        return Promise.resolve(indirectEval(code));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },

    insertCSS(css) {
      const doc = getDocument();
      const style = doc.createElement('style');
      style.textContent = css;
      const mount = doc.head ?? doc.documentElement;
      mount.appendChild(style);
      counter += 1;
      const key = `bunmaska-css-${counter}`;
      inserted.set(key, style);
      return key;
    },

    removeInsertedCSS(key) {
      const style = inserted.get(key);
      if (style === undefined) {
        return;
      }
      inserted.delete(key);
      const mount = getDocument();
      (mount.head ?? mount.documentElement).removeChild(style);
    },

    setZoomFactor(factor) {
      // Match Electron: a factor must be > 0. Ignore non-finite/<=0 values.
      if (!Number.isFinite(factor) || factor <= 0) {
        return;
      }
      getDocument().documentElement.style.zoom = String(factor);
    },

    getZoomFactor() {
      const raw = getDocument().documentElement.style.zoom;
      const factor = Number.parseFloat(raw);
      return Number.isFinite(factor) && factor > 0 ? factor : 1;
    },

    setZoomLevel(level) {
      this.setZoomFactor(ZOOM_STEP ** level);
    },

    getZoomLevel() {
      return Math.log(this.getZoomFactor()) / Math.log(ZOOM_STEP);
    },
  };
};

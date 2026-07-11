import { EventEmitter } from 'node:events';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLogger } from '../../common/logger';
import { decodeEnvelope, encodeEnvelope } from '../ipc/ipc-protocol';
import type {
  KeyboardInputEvent,
  MouseInputEvent,
  NativeInputEvent,
  NativeWebContents,
} from '../platform/native';
import { ipcMain } from './ipc-main';
import { type NativeImage, nativeImage } from './native-image';

/**
 * Controls and observes the content rendered inside a {@link BrowserWindow} —
 * the drop-in equivalent of Electron's `webContents`. Content methods on
 * `BrowserWindow` delegate here (D025). Extends Node {@link EventEmitter}.
 *
 * On construction it bridges the native web view to the {@link ipcMain}
 * singleton: inbound renderer envelopes are routed to `ipcMain`, and any reply
 * is sent back to the renderer — so `ipcMain.handle` + `ipcRenderer.invoke`
 * work end-to-end with no per-window wiring.
 */

const log = createLogger('web-contents');

/** Electron-shaped options for {@link WebContents.loadFile}. */
export type LoadFileOptions = {
  /** URL fragment appended after `#` (e.g. a hash-router route). */
  readonly hash?: string;
  /** Query params as an object, serialized to a query string. */
  readonly query?: Record<string, string>;
  /** Raw query string (takes precedence over `query`). */
  readonly search?: string;
};

let nextId = 1;

/** Reset the id counter. Test-only. */
export const resetWebContentsIdsForTesting = (): void => {
  nextId = 1;
};

/** Build the page-world script that injects a keyed `<style>` for `insertCSS`. */
const buildInsertCssScript = (key: string, css: string): string =>
  `(() => {
    const style = document.createElement('style');
    style.setAttribute('data-bunmaska-css-key', ${JSON.stringify(key)});
    style.textContent = ${JSON.stringify(css)};
    (document.head || document.documentElement).appendChild(style);
  })()`;

/** Build the page-world script that removes the keyed `<style>` for `removeInsertedCSS`. */
const buildRemoveCssScript = (key: string): string =>
  `(() => {
    for (const el of document.querySelectorAll('style[data-bunmaska-css-key]')) {
      if (el.getAttribute('data-bunmaska-css-key') === ${JSON.stringify(key)}) {
        el.remove();
      }
    }
  })()`;

export class WebContents extends EventEmitter {
  /** Process-unique id, matching Electron's `webContents.id`. */
  readonly id: number;
  readonly #native: NativeWebContents;
  #cssCounter = 0;
  #zoomFactor = 1;
  #userAgent = '';
  #isLoading = false;
  #devToolsOpen = false;
  #destroyed = false;

  constructor(native: NativeWebContents) {
    super();
    this.id = nextId;
    nextId += 1;
    this.#native = native;
    this.#native.onRendererEnvelope((json) => {
      void this.#handleRendererEnvelope(json);
    });
    this.#native.onNavigation((event) => {
      if (event.type === 'did-start-loading') {
        this.#isLoading = true;
      } else if (
        event.type === 'did-stop-loading' ||
        event.type === 'did-finish-load' ||
        event.type === 'did-fail-load'
      ) {
        this.#isLoading = false;
      }
      if (event.type === 'did-navigate') {
        this.emit('did-navigate', {}, this.getURL());
      } else if (event.type === 'did-fail-load') {
        this.emit('did-fail-load', {}, event.errorCode, event.errorDescription, this.getURL());
      } else {
        this.emit(event.type);
      }
    });
  }

  /** Navigate to a URL. */
  loadURL(url: string): void {
    this.#native.loadURL(url);
  }

  /**
   * Load a local file by path. `options` mirror Electron's: `hash` (fragment for
   * hash-routed SPAs), `query` (object) or `search` (raw string) for the query.
   * The path itself is percent-encoded, so spaces/`#`/`?` in the FILE NAME load
   * correctly — pass a fragment via `options.hash`, not inside `filePath`.
   */
  loadFile(filePath: string, options?: LoadFileOptions): void {
    const absolute = isAbsolute(filePath) ? filePath : resolve(filePath);
    if (absolute.startsWith('\\\\')) {
      log.warn(
        `loadFile: UNC paths (${absolute}) are not resolved by the WebKit file loader; ` +
          'copy the files locally or serve them over http',
      );
    }
    const url = pathToFileURL(absolute);
    if (options?.search !== undefined) {
      url.search = options.search;
    } else if (options?.query !== undefined) {
      url.search = new URLSearchParams(options.query).toString();
    }
    if (options?.hash !== undefined) {
      url.hash = options.hash;
    }
    this.#native.loadURL(url.href);
  }

  /** The current page URL, or `''` before the first navigation. */
  getURL(): string {
    return this.#native.getURL();
  }

  /** The page's current title, or `''`. */
  getTitle(): string {
    return this.#native.getTitle();
  }

  /** Whether a navigation is currently in progress. */
  isLoading(): boolean {
    return this.#isLoading;
  }

  /** Reload the current page. */
  reload(): void {
    this.#native.reload();
  }

  /** Reload the current page, bypassing the cache. */
  reloadIgnoringCache(): void {
    this.#native.reloadIgnoringCache();
  }

  /** Stop any in-progress load. */
  stop(): void {
    this.#native.stop();
  }

  /** Navigate back one entry in the session history, if possible. */
  goBack(): void {
    this.#native.goBack();
  }

  /** Navigate forward one entry in the session history, if possible. */
  goForward(): void {
    this.#native.goForward();
  }

  /** Whether there is a previous history entry to go back to. */
  canGoBack(): boolean {
    return this.#native.canGoBack();
  }

  /** Whether there is a next history entry to go forward to. */
  canGoForward(): boolean {
    return this.#native.canGoForward();
  }

  /**
   * Evaluate JavaScript in the page and resolve to the script's completion
   * value (Electron semantics). A bare expression resolves to its value; a
   * returned Promise resolves to its fulfilled value; a thrown error rejects.
   * Only JSON-serializable results survive (`JSON.stringify` semantics).
   */
  executeJavaScript(code: string): Promise<unknown> {
    return this.#native.executeJavaScript(code);
  }

  /**
   * Render the current page to a PDF and resolve to its bytes (Electron's
   * `printToPDF`). macOS only for now; rejects on Linux (WebKitGTK has no
   * page-to-PDF-bytes API).
   */
  async printToPDF(): Promise<Buffer> {
    return Buffer.from(await this.#native.printToPDF());
  }

  /**
   * Capture the page to a {@link NativeImage} (Electron's `capturePage`). macOS
   * only for now; rejects on Linux.
   */
  async capturePage(): Promise<NativeImage> {
    return nativeImage.createFromBuffer(await this.#native.capturePage());
  }

  /**
   * Inject a `<style>` block into the page and resolve to a key that
   * {@link removeInsertedCSS} can later use to remove it (Electron semantics).
   * Works on both backends via the page-world exec channel — no native call.
   */
  async insertCSS(css: string): Promise<string> {
    this.#cssCounter += 1;
    const key = `bunmaska-inserted-css-${this.id}-${this.#cssCounter}`;
    await this.#native.executeJavaScript(buildInsertCssScript(key, css));
    return key;
  }

  /** Remove a stylesheet previously added with {@link insertCSS}. */
  async removeInsertedCSS(key: string): Promise<void> {
    await this.#native.executeJavaScript(buildRemoveCssScript(key));
  }

  /** Set the page zoom factor (`1` = 100%) natively. */
  setZoomFactor(factor: number): void {
    this.#zoomFactor = factor;
    this.#native.setZoomFactor(factor);
  }

  /** The current page zoom factor. */
  getZoomFactor(): number {
    return this.#zoomFactor;
  }

  /** Set the page zoom by LEVEL (`0` = 100%); Electron's `zoomFactor = 1.2 ** zoomLevel`. */
  setZoomLevel(level: number): void {
    this.setZoomFactor(1.2 ** level);
  }

  /** The current zoom level (inverse of {@link setZoomLevel}). */
  getZoomLevel(): number {
    return Math.log(this.#zoomFactor) / Math.log(1.2);
  }

  /** Override the User-Agent string for subsequent navigations on this view. */
  setUserAgent(userAgent: string): void {
    this.#userAgent = userAgent;
    this.#native.setUserAgent(userAgent);
  }

  /** The User-Agent override set via {@link setUserAgent}, or `''` if none (platform default). */
  getUserAgent(): string {
    return this.#userAgent;
  }

  /**
   * Synthesize a trusted input event into the page (Electron's `sendInputEvent`).
   * The page receives a real `isTrusted === true` event, which a script-dispatched
   * event cannot fake — needed to drive sites that reject synthetic clicks.
   * Implemented on Windows; other backends throw `UnsupportedPlatformError`.
   */
  sendInputEvent(event: NativeInputEvent): void {
    // Validate at the boundary (Electron throws on a bad event): an unknown type
    // must not silently no-op, and non-finite coordinates must not coerce to a
    // TRUSTED click at (0, 0) on whatever element sits there.
    const type = (event as { type?: unknown }).type;
    if (type === 'mouseDown' || type === 'mouseUp' || type === 'mouseMove') {
      const { x, y } = event as MouseInputEvent;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError(`sendInputEvent: ${type} requires finite numeric x and y`);
      }
    } else if (type === 'keyDown' || type === 'keyUp' || type === 'char') {
      const { keyCode } = event as KeyboardInputEvent;
      if (typeof keyCode !== 'string' || keyCode.length === 0) {
        throw new TypeError(`sendInputEvent: ${type} requires a non-empty string keyCode`);
      }
    } else {
      throw new TypeError(`sendInputEvent: invalid event type ${JSON.stringify(type)}`);
    }
    this.#native.sendInputEvent(event);
  }

  /**
   * Set the handler consulted when the page requests a new window (`window.open`
   * / `target=_blank`). The handler receives `{ url }` and returns `{ action }`.
   * The native popup is always blocked (v1 — child-window creation isn't
   * supported), so apps typically `shell.openExternal(url)` and return `deny`.
   */
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }): void {
    this.#native.setWindowOpenHandler((url) => {
      if (handler({ url }).action === 'allow') {
        log.warn('setWindowOpenHandler { action: "allow" } is not yet supported; window blocked');
      }
    });
  }

  /** Open the developer tools (web inspector) for this view. Best-effort. */
  openDevTools(): void {
    this.#native.openDevTools();
    this.#devToolsOpen = true;
  }

  /** Close the developer tools. Best-effort. */
  closeDevTools(): void {
    this.#native.closeDevTools();
    this.#devToolsOpen = false;
  }

  /** Open the devtools if closed, close them if open. */
  toggleDevTools(): void {
    if (this.#devToolsOpen) {
      this.closeDevTools();
    } else {
      this.openDevTools();
    }
  }

  /** Whether the devtools were last opened (by Bunmaska) and not since closed. */
  isDevToolsOpened(): boolean {
    return this.#devToolsOpen;
  }

  /** Whether the owning window has been closed/destroyed. */
  isDestroyed(): boolean {
    return this.#destroyed;
  }

  /** Mark the contents destroyed — called when the owning window closes. @internal */
  markDestroyed(): void {
    this.#destroyed = true;
  }

  /** Send an event on a channel to the renderer (`ipcRenderer.on` receives it). */
  send(channel: string, ...args: readonly unknown[]): void {
    this.#native.sendEnvelopeToRenderer(encodeEnvelope({ kind: 'send', channel, args }));
  }

  async #handleRendererEnvelope(json: string): Promise<void> {
    let envelope: ReturnType<typeof decodeEnvelope>;
    try {
      envelope = decodeEnvelope(json);
    } catch (error) {
      log.warn('dropping malformed renderer envelope', error);
      return;
    }
    if (envelope.kind !== 'send' && envelope.kind !== 'invoke') {
      return;
    }
    const reply = await ipcMain.dispatch(envelope, { sender: this });
    if (reply !== undefined) {
      this.#native.sendEnvelopeToRenderer(encodeEnvelope(reply));
    }
  }
}

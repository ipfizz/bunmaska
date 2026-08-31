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
 * `BrowserWindow` delegate here (D025). Construction bridges the native web view
 * to the {@link ipcMain} singleton, so there is no per-window IPC wiring.
 */

const log = createLogger('web-contents');

export type LoadFileOptions = {
  /** Appended after `#`, without the `#`. */
  readonly hash?: string;
  readonly query?: Record<string, string>;
  /** Raw query string; takes precedence over `query`. */
  readonly search?: string;
};

let nextId = 1;

/** @internal */
export const resetWebContentsIdsForTesting = (): void => {
  nextId = 1;
};

const buildInsertCssScript = (key: string, css: string): string =>
  `(() => {
    const style = document.createElement('style');
    style.setAttribute('data-bunmaska-css-key', ${JSON.stringify(key)});
    style.textContent = ${JSON.stringify(css)};
    (document.head || document.documentElement).appendChild(style);
  })()`;

const buildRemoveCssScript = (key: string): string =>
  `(() => {
    for (const el of document.querySelectorAll('style[data-bunmaska-css-key]')) {
      if (el.getAttribute('data-bunmaska-css-key') === ${JSON.stringify(key)}) {
        el.remove();
      }
    }
  })()`;

export class WebContents extends EventEmitter {
  /** Process-unique and never reused within a run. */
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

  loadURL(url: string): void {
    this.#native.loadURL(url);
  }

  /**
   * The path is percent-encoded, so spaces/`#`/`?` in the FILE NAME load
   * correctly — pass a fragment via `options.hash`, never inside `filePath`.
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

  /** `''` before the first navigation. */
  getURL(): string {
    return this.#native.getURL();
  }

  getTitle(): string {
    return this.#native.getTitle();
  }

  isLoading(): boolean {
    return this.#isLoading;
  }

  reload(): void {
    this.#native.reload();
  }

  reloadIgnoringCache(): void {
    this.#native.reloadIgnoringCache();
  }

  stop(): void {
    this.#native.stop();
  }

  goBack(): void {
    this.#native.goBack();
  }

  goForward(): void {
    this.#native.goForward();
  }

  canGoBack(): boolean {
    return this.#native.canGoBack();
  }

  canGoForward(): boolean {
    return this.#native.canGoForward();
  }

  /**
   * Resolves to the script's COMPLETION value; a returned Promise is awaited.
   * Only JSON-serializable results survive (`JSON.stringify` semantics).
   */
  executeJavaScript(code: string): Promise<unknown> {
    return this.#native.executeJavaScript(code);
  }

  /**
   * macOS only: neither WebKitGTK nor the WinCairo C API exposes a
   * page-to-PDF-bytes call, so Linux and Windows reject.
   */
  async printToPDF(): Promise<Buffer> {
    return Buffer.from(await this.#native.printToPDF());
  }

  /** macOS and Linux; Windows rejects until its snapshot path is wired. */
  async capturePage(): Promise<NativeImage> {
    return nativeImage.createFromBuffer(await this.#native.capturePage());
  }

  /** Resolves to the key {@link removeInsertedCSS} needs to remove the block. */
  async insertCSS(css: string): Promise<string> {
    this.#cssCounter += 1;
    const key = `bunmaska-inserted-css-${this.id}-${this.#cssCounter}`;
    await this.#native.executeJavaScript(buildInsertCssScript(key, css));
    return key;
  }

  async removeInsertedCSS(key: string): Promise<void> {
    await this.#native.executeJavaScript(buildRemoveCssScript(key));
  }

  /** `1` is 100%. */
  setZoomFactor(factor: number): void {
    this.#zoomFactor = factor;
    this.#native.setZoomFactor(factor);
  }

  getZoomFactor(): number {
    return this.#zoomFactor;
  }

  /** `0` is 100%; Electron's `zoomFactor = 1.2 ** zoomLevel`. */
  setZoomLevel(level: number): void {
    this.setZoomFactor(1.2 ** level);
  }

  getZoomLevel(): number {
    return Math.log(this.#zoomFactor) / Math.log(1.2);
  }

  /** Applies to SUBSEQUENT navigations on this view only. */
  setUserAgent(userAgent: string): void {
    this.#userAgent = userAgent;
    this.#native.setUserAgent(userAgent);
  }

  /** `''` when none is set, meaning the platform default. */
  getUserAgent(): string {
    return this.#userAgent;
  }

  /**
   * The page receives a real `isTrusted === true` event, which a
   * script-dispatched event cannot fake. Implemented on Windows; other backends
   * throw `UnsupportedPlatformError`.
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
   * The native popup is ALWAYS blocked in v1, `allow` included — child-window
   * creation is unsupported, so apps typically `shell.openExternal(url)` and
   * return `deny`.
   */
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }): void {
    this.#native.setWindowOpenHandler((url) => {
      if (handler({ url }).action === 'allow') {
        log.warn('setWindowOpenHandler { action: "allow" } is not yet supported; window blocked');
      }
    });
  }

  /** Best-effort. */
  openDevTools(): void {
    this.#native.openDevTools();
    this.#devToolsOpen = true;
  }

  /** Best-effort. */
  closeDevTools(): void {
    this.#native.closeDevTools();
    this.#devToolsOpen = false;
  }

  toggleDevTools(): void {
    if (this.#devToolsOpen) {
      this.closeDevTools();
    } else {
      this.openDevTools();
    }
  }

  /** Tracks only Bunmaska's own open/close calls, not the user's. */
  isDevToolsOpened(): boolean {
    return this.#devToolsOpen;
  }

  isDestroyed(): boolean {
    return this.#destroyed;
  }

  /** @internal Called when the owning window closes. */
  markDestroyed(): void {
    this.#destroyed = true;
  }

  /** Received by `ipcRenderer.on` in the renderer. */
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

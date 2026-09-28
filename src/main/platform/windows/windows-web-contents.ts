import { UnsupportedPlatformError } from '../../../common/errors';
import { createLogger } from '../../../common/logger';
import { DOM_READY_HANDLER_NAME } from '../dom-ready';
import { ExecResultChannel } from '../exec-result-channel';
import type {
  NativeInputEvent,
  NativeNavigationEvent,
  NativeProtocol,
  NativeWebContents,
} from '../native';
import {
  dispatchScript,
  EXEC_HANDLER_NAME,
  IPC_HANDLER_NAME,
  injectedScripts,
} from '../web-scripts';
import { WINDOW_HANDLER_NAME } from '../window-controls';
import { WindowsWebView } from './windows-webkit-view';

const log = createLogger('windows-web-contents');

/** Windows {@link NativeWebContents}: a WinCairo `WKView` wired for IPC + JS eval. */
export class WindowsWebContents implements NativeWebContents {
  readonly #webView: WindowsWebView;
  readonly #exec: ExecResultChannel;
  #domReady = false;
  readonly #pendingEnvelopes: string[] = [];
  readonly #rendererEnvelopeCallbacks: Array<(json: string) => void> = [];
  readonly #navigationCallbacks: Array<(event: NativeNavigationEvent) => void> = [];
  readonly #windowOpCallbacks: Array<(op: string) => void> = [];

  constructor(
    hwnd: bigint,
    width: number,
    height: number,
    preloadScript?: string,
    frame?: boolean,
    protocol?: NativeProtocol,
  ) {
    const schemes = protocol?.schemes ?? [];
    if (schemes.length > 0) {
      // ponytail: the WinCairo C API has no URL-scheme handler hook at wpewebkit-2.52.5.
      log.warn(`protocol.handle schemes are not served on Windows yet: ${schemes.join(', ')}`);
    }
    // ponytail: no context isolation (S03), preload + window.__bunmaska share the page world;
    // isolation needs a WKBundle script world, i.e. compiled code (D011).
    const scripts = injectedScripts({
      preloadScript,
      frame,
      domReadyWorld: 'page',
      nativeOpChannel: true,
    });
    this.#webView = WindowsWebView.create({
      hwnd,
      width,
      height,
      userScripts: [...scripts.isolated, ...scripts.page],
      messageHandlers: [
        {
          name: IPC_HANDLER_NAME,
          onMessage: (json) => {
            for (const callback of this.#rendererEnvelopeCallbacks) {
              callback(json);
            }
          },
        },
        {
          name: EXEC_HANDLER_NAME,
          onMessage: (json) => this.#exec.deliverExecResult(json),
        },
        {
          name: DOM_READY_HANDLER_NAME,
          onMessage: () => this.#handleDomReady(),
        },
        {
          name: WINDOW_HANDLER_NAME,
          onMessage: (json) => this.#dispatchWindowOp(json),
        },
      ],
      onNavigationEvent: (event) => this.#dispatchNavigation(event),
    });
    this.#exec = new ExecResultChannel((wrapped) => this.#webView.evaluateJavaScript(wrapped));
  }

  /** Flush queued envelopes once the bridge is live, then surface `dom-ready`. */
  #handleDomReady(): void {
    if (!this.#domReady) {
      this.#domReady = true;
      const queued = [...this.#pendingEnvelopes];
      this.#pendingEnvelopes.length = 0;
      for (const json of queued) {
        this.#dispatchToRenderer(json);
      }
    }
    this.#dispatchNavigation({ type: 'dom-ready' });
  }

  #dispatchNavigation(event: NativeNavigationEvent): void {
    for (const callback of this.#navigationCallbacks) {
      callback(event);
    }
  }

  /** Register a handler for window ops a custom title bar triggers (drag, minimize, ...). */
  onWindowOp(callback: (op: string) => void): void {
    this.#windowOpCallbacks.push(callback);
  }

  #dispatchWindowOp(json: string): void {
    let op: unknown;
    try {
      op = (JSON.parse(json) as { op?: unknown }).op;
    } catch {
      return;
    }
    if (typeof op !== 'string') {
      return;
    }
    for (const callback of this.#windowOpCallbacks) {
      callback(op);
    }
  }

  #dispatchToRenderer(json: string): void {
    this.#webView.evaluateJavaScript(dispatchScript(json));
  }

  loadURL(url: string): void {
    this.#webView.loadURL(url);
  }

  loadHTML(html: string, baseUrl?: string): void {
    this.#webView.loadHTML(html, baseUrl);
  }

  getURL(): string {
    return this.#webView.getURL();
  }

  getTitle(): string {
    return this.#webView.getTitle();
  }

  reload(): void {
    this.#webView.reload();
  }

  reloadIgnoringCache(): void {
    this.#webView.reloadIgnoringCache();
  }

  stop(): void {
    this.#webView.stop();
  }

  goBack(): void {
    this.#webView.goBack();
  }

  goForward(): void {
    this.#webView.goForward();
  }

  canGoBack(): boolean {
    return this.#webView.canGoBack();
  }

  canGoForward(): boolean {
    return this.#webView.canGoForward();
  }

  executeJavaScript(code: string): Promise<unknown> {
    return this.#exec.executeJavaScript(code);
  }

  // Engine-blocked on WinCairo: the UI-process WK2 C API on this build exports no
  // PDF sink (`WKPageDrawPagesToPDF` is Cocoa-only; only Begin/Compute/EndPrinting
  // are present, which paginate but yield no PDF data).
  printToPDF(): Promise<Uint8Array> {
    return Promise.reject(
      new UnsupportedPlatformError(
        'webContents.printToPDF is unavailable on Windows: the WinCairo WebKit C API exposes no PDF export',
      ),
    );
  }

  // Engine-blocked on WinCairo: the only snapshot entry points are `WKBundlePage*`
  // (they run in the web content process, unreachable from the UI process over FFI);
  // there is no UI-process `WKPageCreateSnapshot`/`WKViewCreateSnapshot` to call.
  capturePage(): Promise<Uint8Array> {
    return Promise.reject(
      new UnsupportedPlatformError(
        'webContents.capturePage is unavailable on Windows: the WinCairo WebKit C API exposes no UI-process snapshot',
      ),
    );
  }

  openDevTools(): void {
    // ponytail: wire WKInspectorShow(WKPageGetInspector(page)) with developer extras enabled.
    log.warn('openDevTools is not supported on Windows yet: no inspector opens');
  }

  closeDevTools(): void {
    // No inspector ever opens (see openDevTools).
  }

  setZoomFactor(factor: number): void {
    this.#webView.setZoomFactor(factor);
  }

  setUserAgent(userAgent: string): void {
    this.#webView.setUserAgent(userAgent);
  }

  sendInputEvent(event: NativeInputEvent): void {
    this.#webView.sendInputEvent(event);
  }

  /** @internal Resize the hosted view to fill the window's new client area. */
  resize(width: number, height: number): void {
    this.#webView.resize(width, height);
  }

  sendEnvelopeToRenderer(envelopeJson: string): void {
    if (!this.#domReady) {
      this.#pendingEnvelopes.push(envelopeJson);
      return;
    }
    this.#dispatchToRenderer(envelopeJson);
  }

  onRendererEnvelope(callback: (envelopeJson: string) => void): void {
    this.#rendererEnvelopeCallbacks.push(callback);
  }

  onNavigation(callback: (event: NativeNavigationEvent) => void): void {
    this.#navigationCallbacks.push(callback);
  }

  setWindowOpenHandler(_callback: (url: string) => void): void {
    // ponytail: URL dropped (popup still blocked); forward it via WKPageUIClient createNewPage.
    log.warn('setWindowOpenHandler is not supported on Windows yet: the handler is never called');
  }

  /** @internal Settle pending execs and blank the view. Called on window close. */
  dispose(): void {
    this.#exec.destroy();
    this.#webView.dispose();
  }
}

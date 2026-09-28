import { UnsupportedPlatformError } from '../../../common/errors';
import { createLogger } from '../../../common/logger';
import { protocol } from '../../api/protocol';
import {
  generateChannelId,
  generateIsolatedChannelSetup,
  generateIsolatedHostSource,
  generatePageWorldStub,
} from '../../../renderer/api/cross-world-bridge';
import { generatePreloadBootstrap } from '../../../renderer/preload-bootstrap';
import { buildExecWrapper, EXEC_TIMEOUT_MS } from '../../ipc/exec-wrapper';
import { DOM_READY_HANDLER_NAME, generateDomReadyScript } from '../dom-ready';
import type { NativeInputEvent, NativeNavigationEvent, NativeWebContents } from '../native';
import { WINDOW_HANDLER_NAME, windowControlsScript } from '../window-controls';
import { WindowsWebView } from './windows-webkit-view';

const HANDLER_NAME = 'bunmaska';
const EXEC_HANDLER_NAME = 'bunmaskaExec';

const log = createLogger('windows-web-contents');

interface PendingExec {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** `executeJavaScript` over the `bunmaskaExec` script message, not a native callback (D022b). */
class WindowsExecResultChannel {
  readonly #evalInPage: (wrapped: string) => void;
  readonly #pending = new Map<number, PendingExec>();
  #nextExecId = 1;
  #destroyed = false;

  constructor(evalInPage: (wrapped: string) => void) {
    this.#evalInPage = evalInPage;
  }

  executeJavaScript(code: string): Promise<unknown> {
    if (this.#destroyed) {
      return Promise.reject(new Error('executeJavaScript failed: web contents destroyed'));
    }
    const execId = this.#nextExecId;
    this.#nextExecId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(execId);
        reject(new Error(`executeJavaScript timed out after ${EXEC_TIMEOUT_MS}ms`));
      }, EXEC_TIMEOUT_MS);
      this.#pending.set(execId, { resolve, reject, timer });
      this.#evalInPage(buildExecWrapper(execId, EXEC_HANDLER_NAME, code));
    });
  }

  /** Settle the pending exec for the `{ execId, ok, result?, error? }` JSON. */
  deliverExecResult(json: string): void {
    let outcome: { execId?: number; ok?: boolean; result?: unknown; error?: string } | null;
    try {
      outcome = JSON.parse(json);
    } catch (error) {
      log.warn('dropping malformed exec result', error);
      return;
    }
    if (typeof outcome?.execId !== 'number') {
      return;
    }
    const pending = this.#pending.get(outcome.execId);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timer);
    this.#pending.delete(outcome.execId);
    if (outcome.ok) {
      pending.resolve(outcome.result);
    } else {
      pending.reject(new Error(outcome.error ?? 'executeJavaScript failed'));
    }
  }

  /** Settle every still-pending exec to `undefined` and block new ones (teardown). */
  rejectPending(): void {
    this.#destroyed = true;
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.resolve(undefined);
    }
    this.#pending.clear();
  }
}

/** Windows {@link NativeWebContents}: a WinCairo `WKView` wired for IPC + JS eval. */
export class WindowsWebContents implements NativeWebContents {
  readonly #webView: WindowsWebView;
  readonly #exec: WindowsExecResultChannel;
  #domReady = false;
  readonly #pendingEnvelopes: string[] = [];
  readonly #rendererEnvelopeCallbacks: Array<(json: string) => void> = [];
  readonly #navigationCallbacks: Array<(event: NativeNavigationEvent) => void> = [];
  readonly #windowOpCallbacks: Array<(op: string) => void> = [];

  constructor(hwnd: bigint, width: number, height: number, preloadScript?: string) {
    const schemes = protocol.getRegisteredSchemes();
    if (schemes.length > 0) {
      // ponytail: the WinCairo C API has no URL-scheme handler hook at wpewebkit-2.52.5.
      log.warn(`protocol.handle schemes are not served on Windows yet: ${schemes.join(', ')}`);
    }
    const channelId = generateChannelId();
    // ponytail: no context isolation (S03), preload + window.__bunmaska share the page world;
    // isolation needs a WKBundle script world, i.e. compiled code (D011).
    const userScripts: string[] = [
      generateIsolatedChannelSetup(channelId),
      generatePreloadBootstrap(),
      generateIsolatedHostSource(channelId),
      ...(preloadScript !== undefined ? [preloadScript] : []),
      generatePageWorldStub(channelId),
      // Windows has no separate isolated world, so the page world IS the bridge
      // world: it's correct (and necessary) to expose the window-op controls here.
      windowControlsScript({ nativeOpChannel: true }),
      generateDomReadyScript(),
    ];
    this.#webView = WindowsWebView.create({
      hwnd,
      width,
      height,
      userScripts,
      messageHandlers: [
        {
          name: HANDLER_NAME,
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
    this.#exec = new WindowsExecResultChannel((wrapped) =>
      this.#webView.evaluateJavaScript(wrapped),
    );
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
    this.#webView.evaluateJavaScript(
      `window.__bunmaska && window.__bunmaska._dispatch(${JSON.stringify(json)});`,
    );
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
    this.#exec.rejectPending();
    this.#webView.dispose();
  }
}

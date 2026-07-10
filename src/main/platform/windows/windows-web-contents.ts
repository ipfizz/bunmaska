import { UnsupportedPlatformError } from '../../../common/errors';
import { createLogger } from '../../../common/logger';
import {
  generateChannelId,
  generateIsolatedChannelSetup,
  generateIsolatedHostSource,
  generatePageWorldStub,
} from '../../../renderer/api/cross-world-bridge';
import { generatePreloadBootstrap } from '../../../renderer/preload-bootstrap';
import { buildExecWrapper } from '../../ipc/exec-wrapper';
import { DOM_READY_HANDLER_NAME, generateDomReadyScript } from '../dom-ready';
import type { NativeInputEvent, NativeNavigationEvent, NativeWebContents } from '../native';
import { WINDOW_HANDLER_NAME, windowControlsScript } from '../window-controls';
import { WindowsWebView } from './windows-webkit-view';

/**
 * Windows {@link NativeWebContents} on WinCairo WebKit — the mirror of
 * `linux/linux-backend.ts`'s `LinuxWebContents` and `linux/webkit-ipc.ts`.
 *
 * The renderer posts envelopes via `window.webkit.messageHandlers.bunmaska`
 * (native WebKit, so the shared bridge JS works unmodified); the main process
 * pushes envelopes back by evaluating `window.__bunmaska._dispatch(...)`
 * fire-and-forget (D022). `executeJavaScript` returns out-of-band through a
 * `bunmaskaExec` page-world handler (a per-call native completion callback would
 * be freed mid-invocation — the same hazard as macOS/Linux).
 *
 * WinCairo's public C API exposes no named content world, so every script runs in
 * the PAGE world (the cross-world bridge tolerates a shared document); the
 * `BunmaskaPreload` isolation used on macOS/Linux is a follow-up (SPI).
 */

/** The script-message handler name the preload bridge posts envelopes to. */
const HANDLER_NAME = 'bunmaska';
/** Page-world handler name `executeJavaScript` posts its result to. */
const EXEC_HANDLER_NAME = 'bunmaskaExec';

/** Reject a pending `executeJavaScript` after this long (ms). Generous so heavy in-page work — a
 * large file download via XHR, a slow server-rendered PDF — isn't cut off mid-flight. */
const EXEC_TIMEOUT_MS = 120_000;

const log = createLogger('windows-web-contents');

/** A pending `executeJavaScript` awaiting its page-world result message. */
interface PendingExec {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Out-of-band `executeJavaScript` channel — the Windows mirror of
 * `linux/eval-js.ts`. Injects a wrapper that posts `{ execId, ok, result?, error? }`
 * to the `bunmaskaExec` handler (registered once, torn down with the window), and
 * settles the matching Promise here. No per-call native callback to free.
 */
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
    let outcome: { execId?: number; ok?: boolean; result?: unknown; error?: string };
    try {
      outcome = JSON.parse(json);
    } catch (error) {
      log.warn('dropping malformed exec result', error);
      return;
    }
    if (typeof outcome.execId !== 'number') {
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
    const channelId = generateChannelId();
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

  /** Register a handler for window ops a custom title bar triggers (drag/minimize/…). */
  onWindowOp(callback: (op: string) => void): void {
    this.#windowOpCallbacks.push(callback);
  }

  /** Route a `{ op }` message from the built-in title-bar script to its handlers. */
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
  // are present, which paginate but yield no PDF data). Revisit if upstream adds one.
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
    // WinCairo exposes a Web Inspector; wiring it is a seam-fill follow-up.
  }

  closeDevTools(): void {
    // See openDevTools.
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
    // WKPageUIClient createNewPage forwarding; wired in the seam-fill phase
    // (today window.open is blocked, the v1 default).
  }

  /** @internal Reject pending execs and release the view. Called on window close. */
  dispose(): void {
    this.#exec.rejectPending();
    this.#webView.dispose();
  }
}

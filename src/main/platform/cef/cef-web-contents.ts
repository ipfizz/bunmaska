import { FFIType, ptr } from 'bun:ffi';
import { createLogger } from '../../../common/logger';
import type {
  NativeInputEvent,
  NativeNavigationEvent,
  NativeWebContents,
  NativeWindowOptions,
} from '../native';
import {
  dispatchScript,
  IPC_HANDLER_NAME,
  injectedScripts,
  PRELOAD_WORLD_NAME,
} from '../web-scripts';
import {
  registerBrowser,
  sharedClient,
  sharedDevToolsObserver,
  unregisterBrowser,
} from './cef-client';
import { type CdpParams, CdpSession } from './cef-devtools';
import { BROWSER, callMethod, HOST, release, SIZE, setPtr, toAddress } from './cef-ffi';
import { toCdpInput } from './cef-input';

const log = createLogger('cef-web-contents');

const BINDING = '__bunmaskaPost';
const ZOOM_STEP = 1.2;

/**
 * Chromium has no WKScriptMessageHandler: the isolated world gets a CDP binding instead,
 * behind the `webkit.messageHandlers` shape the shared bootstrap captures, so it runs first.
 */
const BINDING_SHIM = `(function(){var g=globalThis;g.webkit={messageHandlers:{${IPC_HANDLER_NAME}:{postMessage:function(s){g.${BINDING}(s);}}}};})();`;

/** One source per world. `dom-ready` comes from CDP, so the shared notifier finds no handler. */
const documentSources = (options: NativeWindowOptions): { isolated: string; page: string } => {
  const scripts = injectedScripts({
    preloadScript: options.preloadScript,
    frame: options.frame,
    domReadyWorld: 'page',
  });
  return {
    isolated: [BINDING_SHIM, ...scripts.isolated].join('\n;\n'),
    page: scripts.page.join('\n;\n'),
  };
};

/** `data:` URL for {@link CefWebContents.loadHTML}; a base URL becomes a `<base>` element. */
export const htmlDataUrl = (html: string, baseUrl?: string): string => {
  const base =
    baseUrl !== undefined && baseUrl.length > 0
      ? `<base href="${baseUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">`
      : '';
  return `data:text/html;charset=utf-8;base64,${Buffer.from(base + html).toString('base64')}`;
};

/** A Chromium page in a CEF browser, driven over the in-process DevTools protocol. */
export class CefWebContents implements NativeWebContents {
  readonly #browser: number;
  readonly #host: number;
  readonly #session: CdpSession;
  readonly #ready: Promise<void>;
  readonly #closed: Promise<void>;
  readonly #registration: number;
  readonly #queuedEnvelopes: string[] = [];
  #mainFrameId = '';
  #mainIsolatedContext = 0;
  #title = '';
  #url = '';
  #alive = true;
  #closing = false;
  #navigated = false;
  #firstLoad = true;
  #onEnvelope: ((json: string) => void) | undefined;
  #onNavigation: ((event: NativeNavigationEvent) => void) | undefined;
  #onWindowOpen: ((url: string) => void) | undefined;

  constructor(browser: number, options: NativeWindowOptions, onFirstLoad: () => void) {
    this.#browser = browser;
    this.#host = toAddress(callMethod(browser, BROWSER.getHost, [], FFIType.ptr));
    this.#session = new CdpSession((json) => {
      const bytes = Buffer.from(json);
      return (
        Number(
          callMethod(
            this.#host,
            HOST.sendDevToolsMessage,
            [FFIType.ptr, FFIType.u64],
            FFIType.i32,
            ptr(bytes),
            bytes.length,
          ),
        ) === 1
      );
    });
    let resolveClosed: () => void = () => undefined;
    this.#closed = new Promise((resolve) => {
      resolveClosed = resolve;
    });
    const id = Number(callMethod(browser, BROWSER.getIdentifier, [], FFIType.i32));
    registerBrowser(id, {
      onLoadingStateChange: () => undefined,
      onMainFrameLoadEnd: () => undefined,
      onMainFrameLoadError: (code, text) => {
        this.#emit({ type: 'did-fail-load', errorCode: code, errorDescription: text });
      },
      onTitleChange: (title) => {
        this.#title = title;
      },
      onBeforePopup: (url) => this.#onWindowOpen?.(url),
      onDevToolsMessage: (text) => this.#session.receive(text),
      onBeforeClose: () => {
        this.#alive = false;
        this.#session.close('the browser closed');
        unregisterBrowser(id);
        release(this.#registration);
        release(this.#host);
        release(this.#browser);
        resolveClosed();
      },
    });
    this.#registration = toAddress(
      callMethod(
        this.#host,
        HOST.addDevToolsMessageObserver,
        [FFIType.ptr],
        FFIType.ptr,
        sharedDevToolsObserver(),
      ),
    );
    this.#listen(onFirstLoad);
    const sources = documentSources(options);
    this.#ready = Promise.all([
      this.#session.call('Runtime.enable'),
      this.#session.call('Page.enable'),
      this.#session.call('Runtime.addBinding', {
        name: BINDING,
        executionContextName: PRELOAD_WORLD_NAME,
      }),
      this.#session.call('Page.addScriptToEvaluateOnNewDocument', {
        source: sources.isolated,
        worldName: PRELOAD_WORLD_NAME,
      }),
      this.#session.call('Page.addScriptToEvaluateOnNewDocument', { source: sources.page }),
      this.#session.call('Page.getFrameTree').then((tree) => {
        const frame = (tree['frameTree'] as { frame?: { id?: unknown } } | undefined)?.frame;
        this.#mainFrameId = typeof frame?.id === 'string' ? frame.id : '';
      }),
    ]).then(() => undefined);
    this.#ready.catch((error: unknown) => log.error('DevTools setup failed', error));
  }

  /** Resolves once CEF destroyed the browser (after {@link close}). */
  get closed(): Promise<void> {
    return this.#closed;
  }

  #listen(onFirstLoad: () => void): void {
    const isMain = (params: CdpParams): boolean => params['frameId'] === this.#mainFrameId;
    this.#session.on('Page.frameStartedLoading', (p) => {
      if (isMain(p)) {
        this.#emit({ type: 'did-start-loading' });
      }
    });
    this.#session.on('Page.frameNavigated', (p) => {
      const frame = p['frame'] as
        | { parentId?: unknown; url?: unknown; urlFragment?: unknown }
        | undefined;
      if (frame !== undefined && frame.parentId === undefined) {
        this.#url = `${String(frame.url ?? '')}${String(frame.urlFragment ?? '')}`;
        this.#emit({ type: 'did-navigate' });
      }
    });
    this.#session.on('Page.domContentEventFired', () => this.#emit({ type: 'dom-ready' }));
    this.#session.on('Page.loadEventFired', () => {
      this.#emit({ type: 'did-finish-load' });
      if (this.#navigated && this.#firstLoad) {
        this.#firstLoad = false;
        onFirstLoad();
      }
    });
    this.#session.on('Page.frameStoppedLoading', (p) => {
      if (isMain(p)) {
        this.#emit({ type: 'did-stop-loading' });
      }
    });
    this.#session.on('Runtime.executionContextCreated', (p) => {
      const context = p['context'] as { id: number; name: string; auxData?: { frameId?: string } };
      if (context.name === PRELOAD_WORLD_NAME && context.auxData?.frameId === this.#mainFrameId) {
        this.#mainIsolatedContext = context.id;
        this.#flushEnvelopes();
      }
    });
    this.#session.on('Runtime.executionContextDestroyed', (p) => {
      if (p['executionContextId'] === this.#mainIsolatedContext) {
        this.#mainIsolatedContext = 0;
      }
    });
    this.#session.on('Runtime.executionContextsCleared', () => {
      this.#mainIsolatedContext = 0;
    });
    // CDP injects into every frame, but the preload is main-frame only: iframes never reach IPC.
    this.#session.on('Runtime.bindingCalled', (p) => {
      const context = p['executionContextId'];
      if (p['name'] === BINDING && context !== 0 && context === this.#mainIsolatedContext) {
        this.#onEnvelope?.(String(p['payload']));
      }
    });
  }

  /** Nothing before the app's first load (the internal about:blank) is reported. */
  #emit(event: NativeNavigationEvent): void {
    if (this.#navigated) {
      this.#onNavigation?.(event);
    }
  }

  #call(method: string, params: CdpParams = {}): Promise<CdpParams> {
    return this.#ready.then(() => this.#session.call(method, params));
  }

  #fireAndForget(method: string, params: CdpParams): void {
    this.#call(method, params).catch((error: unknown) => log.warn(`${method} failed`, error));
  }

  #flushEnvelopes(): void {
    while (this.#mainIsolatedContext !== 0 && this.#queuedEnvelopes.length > 0) {
      const json = this.#queuedEnvelopes.shift() ?? '';
      this.#fireAndForget('Runtime.evaluate', {
        expression: dispatchScript(json),
        contextId: this.#mainIsolatedContext,
      });
    }
  }

  loadURL(url: string): void {
    this.#navigated = true;
    this.#fireAndForget('Page.navigate', { url });
  }

  loadHTML(html: string, baseUrl?: string): void {
    this.loadURL(htmlDataUrl(html, baseUrl));
  }

  getURL(): string {
    return this.#url;
  }

  getTitle(): string {
    return this.#title;
  }

  #browserCall(offset: number): void {
    if (this.#alive) {
      callMethod(this.#browser, offset, [], FFIType.void);
    }
  }

  reload(): void {
    this.#browserCall(BROWSER.reload);
  }

  reloadIgnoringCache(): void {
    this.#browserCall(BROWSER.reloadIgnoreCache);
  }

  stop(): void {
    this.#browserCall(BROWSER.stopLoad);
  }

  goBack(): void {
    this.#browserCall(BROWSER.goBack);
  }

  goForward(): void {
    this.#browserCall(BROWSER.goForward);
  }

  canGoBack(): boolean {
    return (
      this.#alive && Number(callMethod(this.#browser, BROWSER.canGoBack, [], FFIType.i32)) === 1
    );
  }

  canGoForward(): boolean {
    return (
      this.#alive && Number(callMethod(this.#browser, BROWSER.canGoForward, [], FFIType.i32)) === 1
    );
  }

  async executeJavaScript(code: string): Promise<unknown> {
    if (this.#closing) {
      throw new Error('executeJavaScript failed: web contents destroyed');
    }
    let response: CdpParams;
    try {
      response = await this.#call('Runtime.evaluate', {
        expression: code,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
    } catch (error) {
      // As on WebKit: an exec cut off by the close must not become an unhandled rejection.
      if (this.#closing) {
        return undefined;
      }
      throw error;
    }
    const details = response['exceptionDetails'] as
      | { text?: string; exception?: { description?: string } }
      | undefined;
    if (details !== undefined) {
      throw new Error(details.exception?.description ?? details.text ?? 'executeJavaScript failed');
    }
    return (response['result'] as { value?: unknown } | undefined)?.value;
  }

  async printToPDF(): Promise<Uint8Array> {
    const response = await this.#call('Page.printToPDF');
    return new Uint8Array(Buffer.from(String(response['data']), 'base64'));
  }

  async capturePage(): Promise<Uint8Array> {
    const response = await this.#call('Page.captureScreenshot', { format: 'png' });
    return new Uint8Array(Buffer.from(String(response['data']), 'base64'));
  }

  openDevTools(): void {
    if (!this.#alive) {
      return;
    }
    const windowInfo = Buffer.alloc(SIZE.windowInfo);
    setPtr(windowInfo, 0, SIZE.windowInfo);
    const settings = Buffer.alloc(SIZE.browserSettings);
    setPtr(settings, 0, SIZE.browserSettings);
    callMethod(
      this.#host,
      HOST.showDevTools,
      [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      FFIType.void,
      ptr(windowInfo),
      sharedClient(),
      ptr(settings),
      null,
    );
  }

  closeDevTools(): void {
    if (this.#alive) {
      callMethod(this.#host, HOST.closeDevTools, [], FFIType.void);
    }
  }

  setZoomFactor(factor: number): void {
    if (this.#alive && factor > 0) {
      callMethod(
        this.#host,
        HOST.setZoomLevel,
        [FFIType.f64],
        FFIType.void,
        Math.log(factor) / Math.log(ZOOM_STEP),
      );
    }
  }

  setUserAgent(userAgent: string): void {
    this.#fireAndForget('Emulation.setUserAgentOverride', { userAgent });
  }

  sendInputEvent(event: NativeInputEvent): void {
    const input = toCdpInput(event);
    this.#fireAndForget(input.method, input.params);
  }

  sendEnvelopeToRenderer(envelopeJson: string): void {
    if (!this.#alive) {
      return;
    }
    this.#queuedEnvelopes.push(envelopeJson);
    this.#flushEnvelopes();
  }

  onRendererEnvelope(callback: (envelopeJson: string) => void): void {
    this.#onEnvelope = callback;
  }

  onNavigation(callback: (event: NativeNavigationEvent) => void): void {
    this.#onNavigation = callback;
  }

  setWindowOpenHandler(callback: (url: string) => void): void {
    this.#onWindowOpen = callback;
  }

  /** Force-close the browser (no unload handlers); {@link closed} settles after. */
  close(): void {
    this.#closing = true;
    if (this.#alive) {
      callMethod(this.#host, HOST.closeBrowser, [FFIType.i32], FFIType.void, 1);
    }
  }
}

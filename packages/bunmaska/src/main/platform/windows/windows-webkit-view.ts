import { FFIType, JSCallback, type Pointer, ptr } from 'bun:ffi';
import { FFIError } from '../../../common/errors';
import { wkRelease, wkString, wkStringToJs, wkUrl, wkUrlToJs } from './webkit-string';
import { loadWebKit2, WK_INJECT_AT_DOCUMENT_START } from './webkit2-ffi';
import { loadUser32 } from './win32-ffi';
import { createNativeChildHost, ensureOleInitialized } from './windows-native-window';

/**
 * A `WKView` hosted in a Win32 HWND, wired for document-start script injection
 * and the renderer->main script-message bridge — the WinCairo peer of
 * `linux/webkit-ipc.ts` (WebKitUserContentManager) and the macOS WKWebView setup.
 *
 * The view is parented into a dedicated NATIVE-WndProc child window
 * ({@link createNativeChildHost}); WebKit floods its host with re-entrant messages
 * during a load, which a `bun:ffi` `JSCallback` WndProc cannot survive (see
 * `windows-native-window.ts`). COM is initialised on the thread first
 * ({@link ensureOleInitialized}), exactly as WinCairo's MiniBrowser does.
 *
 * Note on worlds: the public WebKit2 C API exposes no named content world, so the
 * injected scripts and the `window.webkit.messageHandlers.<name>` bridge run in
 * the PAGE world. Each script-message JSCallback is retained for the view's life
 * and closed only on {@link WindowsWebView.dispose} — never mid-call.
 */

/** `SetWindowPos` flags for an in-place resize (keep position, z-order, focus). */
const SWP_NOMOVE_NOZORDER_NOACTIVATE = 0x0002 | 0x0004 | 0x0010;

/** A script-message handler name and the JS callback that receives its bodies. */
export interface ScriptMessageHandler {
  readonly name: string;
  readonly onMessage: (body: string) => void;
}

/** Options for {@link WindowsWebView.create}. */
export interface WebViewOptions {
  /** Parent window handle (the owning native window) to host the view inside. */
  readonly hwnd: bigint;
  readonly width: number;
  readonly height: number;
  /** Sources injected at document-start, in order, in all frames. */
  readonly userScripts: readonly string[];
  /** Renderer->main message handlers, keyed by their `messageHandlers` name. */
  readonly messageHandlers: readonly ScriptMessageHandler[];
}

/** A live WebKit view + its retained FFI resources. */
export class WindowsWebView {
  readonly #view: Pointer;
  readonly #page: Pointer;
  readonly #hostWindow: bigint;
  readonly #retainedContext: Pointer;
  readonly #retainedController: Pointer;
  readonly #callbacks: JSCallback[];
  #disposed = false;

  private constructor(
    view: Pointer,
    page: Pointer,
    hostWindow: bigint,
    context: Pointer,
    controller: Pointer,
    callbacks: JSCallback[],
  ) {
    this.#view = view;
    this.#page = page;
    this.#hostWindow = hostWindow;
    this.#retainedContext = context;
    this.#retainedController = controller;
    this.#callbacks = callbacks;
  }

  /** Build a wired WebKit view hosted in a native child of `options.hwnd`. */
  static create(options: WebViewOptions): WindowsWebView {
    ensureOleInitialized();
    const wk = loadWebKit2();
    const s = wk.symbols;

    const contextConfig = s.WKContextConfigurationCreate();
    const context = s.WKContextCreateWithConfiguration(contextConfig);
    wkRelease(contextConfig);
    if (context === null) {
      throw new FFIError('WKContextCreateWithConfiguration returned NULL');
    }

    const controller = s.WKUserContentControllerCreate();
    if (controller === null) {
      throw new FFIError('WKUserContentControllerCreate returned NULL');
    }

    // Register the renderer->main message handlers. Each callback is retained for
    // the view's lifetime; the OS invokes it synchronously during the message pump.
    const callbacks: JSCallback[] = [];
    for (const handler of options.messageHandlers) {
      const callback = new JSCallback(
        (messageRef: Pointer) => {
          const bodyRef = s.WKScriptMessageGetBody(messageRef);
          if (bodyRef !== null) {
            handler.onMessage(wkStringToJs(bodyRef));
          }
        },
        { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
      );
      if (callback.ptr === null) {
        throw new FFIError(`failed to allocate the '${handler.name}' message-handler trampoline`);
      }
      const nameRef = wkString(handler.name);
      s.WKUserContentControllerAddScriptMessageHandler(controller, nameRef, callback.ptr, null);
      wkRelease(nameRef);
      callbacks.push(callback);
    }

    // Inject the preload/bridge sources at document-start, in order.
    for (const source of options.userScripts) {
      const sourceRef = wkString(source);
      const userScript = s.WKUserScriptCreateWithSource(sourceRef, WK_INJECT_AT_DOCUMENT_START, 0);
      wkRelease(sourceRef);
      if (userScript !== null) {
        s.WKUserContentControllerAddUserScript(controller, userScript);
        wkRelease(userScript);
      }
    }

    const pageConfig = s.WKPageConfigurationCreate();
    s.WKPageConfigurationSetContext(pageConfig, context);
    s.WKPageConfigurationSetUserContentController(pageConfig, controller);
    const preferences = s.WKPageConfigurationGetPreferences(pageConfig);
    if (preferences !== null) {
      s.WKPreferencesSetJavaScriptEnabled(preferences, 1);
    }

    const hostWindow = createNativeChildHost(options.hwnd, options.width, options.height);

    // RECT{left,top,right,bottom}: fill the host child. Win64 passes the 16-byte
    // struct by hidden pointer, so we hand WKViewCreate the RECT buffer.
    const rect = new Int32Array([0, 0, options.width, options.height]);
    const view = s.WKViewCreate(ptr(rect), pageConfig, hostWindow);
    wkRelease(pageConfig);
    if (view === null) {
      throw new FFIError('WKViewCreate returned NULL');
    }
    s.WKViewSetIsInWindow(view, 1);
    const page = s.WKViewGetPage(view);
    if (page === null) {
      throw new FFIError('WKViewGetPage returned NULL');
    }

    return new WindowsWebView(view, page, hostWindow, context, controller, callbacks);
  }

  /** The underlying `WKPageRef`. */
  page(): Pointer {
    return this.#page;
  }

  /** The underlying `WKViewRef`. */
  view(): Pointer {
    return this.#view;
  }

  /** Navigate to a URL (http/https/file/about). */
  loadURL(url: string): void {
    const urlRef = wkUrl(url);
    loadWebKit2().symbols.WKPageLoadURL(this.#page, urlRef);
    wkRelease(urlRef);
  }

  /** Load an inline HTML string with an optional base URL for relative refs. */
  loadHTML(html: string, baseUrl?: string): void {
    const wk = loadWebKit2();
    const htmlRef = wkString(html);
    const baseRef = baseUrl !== undefined ? wkUrl(baseUrl) : null;
    wk.symbols.WKPageLoadHTMLString(this.#page, htmlRef, baseRef);
    wkRelease(htmlRef);
    wkRelease(baseRef);
  }

  /** Evaluate JS in the page world, fire-and-forget (results return out-of-band). */
  evaluateJavaScript(code: string): void {
    const codeRef = wkString(code);
    loadWebKit2().symbols.WKPageEvaluateJavaScriptInMainFrame(this.#page, codeRef, null, null);
    wkRelease(codeRef);
  }

  /** The current page URL, or `''` before the first navigation. */
  getURL(): string {
    const urlRef = loadWebKit2().symbols.WKPageCopyActiveURL(this.#page);
    if (urlRef === null) {
      return '';
    }
    const url = wkUrlToJs(urlRef);
    wkRelease(urlRef);
    return url;
  }

  /** The current page title, or `''` if none. */
  getTitle(): string {
    const titleRef = loadWebKit2().symbols.WKPageCopyTitle(this.#page);
    if (titleRef === null) {
      return '';
    }
    const title = wkStringToJs(titleRef);
    wkRelease(titleRef);
    return title;
  }

  reload(): void {
    loadWebKit2().symbols.WKPageReload(this.#page);
  }

  reloadIgnoringCache(): void {
    loadWebKit2().symbols.WKPageReloadFromOrigin(this.#page);
  }

  stop(): void {
    loadWebKit2().symbols.WKPageStopLoading(this.#page);
  }

  goBack(): void {
    loadWebKit2().symbols.WKPageGoBack(this.#page);
  }

  goForward(): void {
    loadWebKit2().symbols.WKPageGoForward(this.#page);
  }

  canGoBack(): boolean {
    return loadWebKit2().symbols.WKPageCanGoBack(this.#page);
  }

  canGoForward(): boolean {
    return loadWebKit2().symbols.WKPageCanGoForward(this.#page);
  }

  /** Resize the host child + the WKView to fill `width` x `height` physical px. */
  resize(width: number, height: number): void {
    const user32 = loadUser32().symbols;
    user32.SetWindowPos(this.#hostWindow, 0n, 0, 0, width, height, SWP_NOMOVE_NOZORDER_NOACTIVATE);
    const viewWindow = loadWebKit2().symbols.WKViewGetWindow(this.#view);
    if (viewWindow !== 0n) {
      user32.MoveWindow(viewWindow, 0, 0, width, height, 1);
    }
  }

  setZoomFactor(factor: number): void {
    loadWebKit2().symbols.WKPageSetPageZoomFactor(this.#page, factor);
  }

  setUserAgent(userAgent: string): void {
    const uaRef = wkString(userAgent);
    loadWebKit2().symbols.WKPageSetCustomUserAgent(this.#page, uaRef);
    wkRelease(uaRef);
  }

  /** Release the view, destroy the host child, and close every callback. Idempotent. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const wk = loadWebKit2();
    wk.symbols.WKUserContentControllerRemoveAllUserMessageHandlers(this.#retainedController);
    wkRelease(this.#view);
    wkRelease(this.#retainedController);
    wkRelease(this.#retainedContext);
    loadUser32().symbols.DestroyWindow(this.#hostWindow);
    for (const callback of this.#callbacks) {
      callback.close();
    }
  }
}

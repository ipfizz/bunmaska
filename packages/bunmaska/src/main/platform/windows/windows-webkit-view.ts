import { FFIType, JSCallback, type Pointer, ptr } from 'bun:ffi';
import { FFIError } from '../../../common/errors';
import { cstr } from '../cstr';
import { wkRelease, wkString, wkStringToJs, wkUrl } from './webkit-string';
import { loadWebKit2, WK_INJECT_AT_DOCUMENT_START } from './webkit2-ffi';
import { wstr } from './win32';
import { loadKernel32, loadOle32, loadUser32 } from './win32-ffi';

/**
 * A `WKView` hosted in a Win32 HWND, wired for document-start script injection
 * and the renderer->main script-message bridge — the WinCairo peer of
 * `linux/webkit-ipc.ts` (WebKitUserContentManager) and the macOS WKWebView setup.
 *
 * Two hard-won WinCairo requirements are baked in here (verified on a real engine):
 *
 *  1. COM must be initialised on the thread before any WebKit use (`OleInitialize`),
 *     exactly as WinCairo's MiniBrowser does; without it the WebProcess IPC crashes.
 *  2. The WKView is parented into a dedicated NATIVE-WndProc child window, not the
 *     caller's window. WebKit floods its host window with messages during a load,
 *     and a `bun:ffi` `JSCallback` WndProc cannot survive that re-entrant flood — a
 *     native `DefWindowProc` host can. The owning `Win32Window` keeps its JSCallback
 *     WndProc for low-frequency lifecycle events; the web view lives one level down.
 *
 * Note on worlds: the public WebKit2 C API exposes no named content world, so the
 * injected scripts and the `window.webkit.messageHandlers.<name>` bridge run in
 * the PAGE world. Each script-message JSCallback is retained for the view's life
 * and closed only on {@link WindowsWebView.dispose} — never mid-call.
 */

const WEB_HOST_CLASS_NAME = 'BunmaskaWebHost';
const WNDCLASSEXW_SIZE = 80;
const WS_CHILD = 0x40000000;
const WS_VISIBLE = 0x10000000;
const WS_CLIPCHILDREN = 0x02000000;
const WS_OVERLAPPEDWINDOW = 0x00cf0000;
const CW_USEDEFAULT = -0x80000000;

let oleInitialized = false;
let webHostRegistered = false;
// Pinned for the process lifetime: the registered class references the name buffer.
let webHostClassName: Uint8Array | undefined;

/** Initialise COM on this thread once (WinCairo WebKit requires it). */
const ensureOleInitialized = (): void => {
  if (oleInitialized) {
    return;
  }
  loadOle32().symbols.OleInitialize(null);
  oleInitialized = true;
};

/** Register the native-WndProc web-host child class once; return the `HINSTANCE`. */
const ensureWebHostClass = (): bigint => {
  const kernel32 = loadKernel32();
  const hInstance = kernel32.symbols.GetModuleHandleW(null);
  if (webHostRegistered) {
    return hInstance;
  }
  // Use the system DefWindowProcW directly as the class's window procedure.
  const user32Module = kernel32.symbols.GetModuleHandleW(ptr(wstr('user32.dll')));
  const defWindowProc = kernel32.symbols.GetProcAddress(user32Module, cstr('DefWindowProcW'));
  if (defWindowProc === 0n) {
    throw new FFIError('GetProcAddress(DefWindowProcW) failed');
  }
  webHostClassName = wstr(WEB_HOST_CLASS_NAME);
  const wc = new Uint8Array(WNDCLASSEXW_SIZE);
  const dv = new DataView(wc.buffer);
  dv.setUint32(0, WNDCLASSEXW_SIZE, true); // cbSize
  dv.setBigUint64(8, defWindowProc, true); // lpfnWndProc = native DefWindowProcW
  dv.setBigUint64(24, hInstance, true); // hInstance
  dv.setBigUint64(64, BigInt(ptr(webHostClassName)), true); // lpszClassName
  if (loadUser32().symbols.RegisterClassExW(ptr(wc)) === 0) {
    throw new FFIError('RegisterClassExW failed for the Bunmaska web-host class');
  }
  webHostRegistered = true;
  return hInstance;
};

/** Create the native child window that hosts the WKView inside `parentHwnd`. */
const createWebHostChild = (parentHwnd: bigint, width: number, height: number): bigint => {
  const hInstance = ensureWebHostClass();
  const className = webHostClassName;
  if (className === undefined) {
    throw new FFIError('web-host class buffer was not initialised');
  }
  const hwnd = loadUser32().symbols.CreateWindowExW(
    0,
    ptr(className),
    ptr(wstr('')),
    (WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN) >>> 0,
    0,
    0,
    width,
    height,
    parentHwnd,
    0n,
    hInstance,
    null,
  );
  if (hwnd === 0n) {
    throw new FFIError('CreateWindowExW returned NULL for the web-host child');
  }
  return hwnd;
};

/**
 * Create a NATIVE-WndProc top-level window suitable for hosting a WKView.
 *
 * The window that hosts WebKit must use a native window procedure: WebKit floods
 * its host (and that host's ancestors) with re-entrant messages during a load,
 * which a `bun:ffi` `JSCallback` WndProc cannot survive. This is the foundation a
 * full Windows `NativeWindow` is built on — lifecycle events are routed without a
 * JSCallback WndProc (see `.admin/WINDOWS.md`). Returns the HWND; the caller
 * destroys it with `DestroyWindow`.
 */
export const createNativeHostWindow = (title: string, width: number, height: number): bigint => {
  const hInstance = ensureWebHostClass();
  const className = webHostClassName;
  if (className === undefined) {
    throw new FFIError('web-host class buffer was not initialised');
  }
  const hwnd = loadUser32().symbols.CreateWindowExW(
    0,
    ptr(className),
    ptr(wstr(title)),
    (WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN) >>> 0,
    CW_USEDEFAULT,
    0,
    width,
    height,
    0n,
    0n,
    hInstance,
    null,
  );
  if (hwnd === 0n) {
    throw new FFIError('CreateWindowExW returned NULL for the native host window');
  }
  return hwnd;
};

/** A script-message handler name and the JS callback that receives its bodies. */
export interface ScriptMessageHandler {
  readonly name: string;
  readonly onMessage: (body: string) => void;
}

/** Options for {@link WindowsWebView.create}. */
export interface WebViewOptions {
  /** Parent window handle (the owning `Win32Window`) to host the view inside. */
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

    const hostWindow = createWebHostChild(options.hwnd, options.width, options.height);

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

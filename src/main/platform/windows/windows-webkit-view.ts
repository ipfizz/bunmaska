import { FFIType, JSCallback, type Pointer, ptr } from 'bun:ffi';
import { FFIError } from '../../../common/errors';
import type { NativeInputEvent, NativeNavigationEvent } from '../native';
import { wkRelease, wkString, wkStringToJs, wkUrl, wkUrlToJs } from './webkit-string';
import { loadWebKit2, WK_INJECT_AT_DOCUMENT_START } from './webkit2-ffi';
import { loadKernel32, loadUser32 } from './win32-ffi';
import { heldButtonsAfter, postWindowsInputEvent } from './windows-input';
import { createNativeChildHost, ensureOleInitialized } from './windows-native-window';

// D043: the view's host must be a native-WndProc child; WebKit's re-entrant message flood
// kills a JSCallback WndProc. The C API has no named content world, so every injected script
// and message handler lives in the PAGE world.

const SWP_NOMOVE_NOZORDER_NOACTIVATE = 0x0002 | 0x0004 | 0x0010;

/** Never closed (D043: closing one mid-teardown is a use-after-free); dispose empties its sinks. */
const retainedTrampolines: JSCallback[] = [];
const retainTrampolines = (callbacks: readonly JSCallback[]): void => {
  retainedTrampolines.push(...callbacks);
};

/** `(HANDLE)-1`, the current-process pseudo-handle. */
const CURRENT_PROCESS = 0xffffffffffffffffn;
let cleanExitInstalled = false;

/** D043: WinCairo crashes in DLL-detach teardown on a normal exit, so hard-terminate on `exit`. */
const installCleanExit = (): void => {
  if (cleanExitInstalled) {
    return;
  }
  cleanExitInstalled = true;
  process.on('exit', (code) => {
    loadKernel32().symbols.TerminateProcess(CURRENT_PROCESS, code >>> 0);
  });
};

/** One process pool for every view, never freed. Cookies live in the default WebsiteDataStore. */
let sharedContext: Pointer | null = null;
const sharedWebKitContext = (): Pointer => {
  if (sharedContext !== null) {
    return sharedContext;
  }
  const s = loadWebKit2().symbols;
  const contextConfig = s.WKContextConfigurationCreate();
  if (contextConfig === null) {
    throw new FFIError('WKContextConfigurationCreate returned NULL');
  }
  const context = s.WKContextCreateWithConfiguration(contextConfig);
  wkRelease(contextConfig);
  if (context === null) {
    throw new FFIError('WKContextCreateWithConfiguration returned NULL');
  }
  sharedContext = context;
  return context;
};

// WKPageNavigationClientV0 (x64): a 16-byte base { int version; padding; const void* }
// followed by 21 function pointers. We wire five and NULL the rest.
const NAV_CLIENT_SIZE = 184;
const NAV_OFF_DID_START = 40; // didStartProvisionalNavigation
const NAV_OFF_DID_FAIL_PROVISIONAL = 56; // didFailProvisionalNavigation (error)
const NAV_OFF_DID_COMMIT = 64; // didCommitNavigation
const NAV_OFF_DID_FINISH = 72; // didFinishNavigation
const NAV_OFF_DID_FAIL = 80; // didFailNavigation (error)

/** Read a `WKErrorRef` into a code + localized description (for did-fail-load). */
const readWkError = (errorRef: Pointer | null): { code: number; description: string } => {
  if (errorRef === null) {
    return { code: -1, description: '' };
  }
  const wk = loadWebKit2().symbols;
  const code = wk.WKErrorGetErrorCode(errorRef);
  const descRef = wk.WKErrorCopyLocalizedDescription(errorRef);
  const description = descRef !== null ? wkStringToJs(descRef) : '';
  wkRelease(descRef);
  return { code, description };
};

/** Register the page navigation client; returns its trampolines for D043 retention. */
const setupNavigationClient = (
  page: Pointer,
  onEvent: (event: NativeNavigationEvent) => void,
): JSCallback[] => {
  const callbacks: JSCallback[] = [];
  const simple = (...events: readonly NativeNavigationEvent[]): number => {
    const cb = new JSCallback(
      () => {
        for (const event of events) {
          onEvent(event);
        }
      },
      { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
    );
    if (cb.ptr === null) {
      throw new FFIError('failed to allocate a navigation-client trampoline');
    }
    callbacks.push(cb);
    return cb.ptr;
  };
  const failure = (): number => {
    const cb = new JSCallback(
      (_page: Pointer, _navigation: Pointer, errorRef: Pointer | null) => {
        const { code, description } = readWkError(errorRef);
        onEvent({ type: 'did-fail-load', errorCode: code, errorDescription: description });
        onEvent({ type: 'did-stop-loading' });
      },
      {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
        returns: FFIType.void,
      },
    );
    if (cb.ptr === null) {
      throw new FFIError('failed to allocate a navigation-failure trampoline');
    }
    callbacks.push(cb);
    return cb.ptr;
  };

  const client = new Uint8Array(NAV_CLIENT_SIZE);
  const dv = new DataView(client.buffer);
  dv.setUint32(0, 0, true); // base.version = 0
  dv.setBigUint64(NAV_OFF_DID_START, BigInt(simple({ type: 'did-start-loading' })), true);
  dv.setBigUint64(NAV_OFF_DID_FAIL_PROVISIONAL, BigInt(failure()), true);
  dv.setBigUint64(NAV_OFF_DID_COMMIT, BigInt(simple({ type: 'did-navigate' })), true);
  dv.setBigUint64(
    NAV_OFF_DID_FINISH,
    BigInt(simple({ type: 'did-finish-load' }, { type: 'did-stop-loading' })),
    true,
  );
  dv.setBigUint64(NAV_OFF_DID_FAIL, BigInt(failure()), true);
  loadWebKit2().symbols.WKPageSetPageNavigationClient(page, ptr(client));
  return callbacks;
};

type ScriptMessageApi = Pick<
  ReturnType<typeof loadWebKit2>['symbols'],
  | 'WKScriptMessageGetBody'
  | 'WKScriptMessageGetFrameInfo'
  | 'WKFrameInfoGetIsMainFrame'
  | 'WKGetTypeID'
  | 'WKStringGetTypeID'
  | 'WKCompletionListenerComplete'
>;

/** Forward a main-frame script message's string body to `onMessage`, then complete its reply. */
export const deliverScriptMessage = (
  message: Pointer,
  listener: Pointer | null,
  onMessage: (body: string) => void,
  wk: ScriptMessageApi = loadWebKit2().symbols,
  readString: (ref: Pointer) => string = wkStringToJs,
): void => {
  try {
    // The handlers live in the page world, so any iframe could post to the bridge.
    if (!wk.WKFrameInfoGetIsMainFrame(wk.WKScriptMessageGetFrameInfo(message))) {
      return;
    }
    const body = wk.WKScriptMessageGetBody(message);
    // Any page script can post a number/bool/object; reading that as a WKString faults the process.
    if (body !== null && wk.WKGetTypeID(body) === wk.WKStringGetTypeID()) {
      onMessage(readString(body));
    }
  } finally {
    // An unanswered reply pins the posting document's global object in the WebContent process.
    if (listener !== null) {
      wk.WKCompletionListenerComplete(listener, null);
    }
  }
};

export interface ScriptMessageHandler {
  readonly name: string;
  readonly onMessage: (body: string) => void;
}

export interface WebViewOptions {
  /** Parent window handle (the owning native window) to host the view inside. */
  readonly hwnd: bigint;
  readonly width: number;
  readonly height: number;
  /** Sources injected at document-start, in order, in the main frame only. */
  readonly userScripts: readonly string[];
  /** Renderer->main message handlers, keyed by their `messageHandlers` name. */
  readonly messageHandlers: readonly ScriptMessageHandler[];
  /** Navigation lifecycle sink (did-start/commit/finish/fail). */
  readonly onNavigationEvent?: (event: NativeNavigationEvent) => void;
}

/** What the process-lifetime trampolines call; dispose empties it so they pin no closed window. */
type TrampolineSinks = {
  readonly messages: Map<string, (body: string) => void>;
  navigation: ((event: NativeNavigationEvent) => void) | undefined;
};

/** A live WebKit view + its retained FFI resources. */
export class WindowsWebView {
  readonly #view: Pointer;
  readonly #page: Pointer;
  readonly #hostWindow: bigint;
  readonly #retainedController: Pointer;
  readonly #callbacks: JSCallback[];
  readonly #sinks: TrampolineSinks;
  #disposed = false;
  #heldButtons = 0;

  private constructor(
    view: Pointer,
    page: Pointer,
    hostWindow: bigint,
    controller: Pointer,
    callbacks: JSCallback[],
    sinks: TrampolineSinks,
  ) {
    this.#view = view;
    this.#page = page;
    this.#hostWindow = hostWindow;
    this.#retainedController = controller;
    this.#callbacks = callbacks;
    this.#sinks = sinks;
  }

  /** Build a wired WebKit view hosted in a native child of `options.hwnd`. */
  static create(options: WebViewOptions): WindowsWebView {
    ensureOleInitialized();
    installCleanExit();
    const wk = loadWebKit2();
    const s = wk.symbols;
    const context = sharedWebKitContext();

    const controller = s.WKUserContentControllerCreate();
    if (controller === null) {
      throw new FFIError('WKUserContentControllerCreate returned NULL');
    }

    const sinks: TrampolineSinks = {
      messages: new Map(options.messageHandlers.map(({ name, onMessage }) => [name, onMessage])),
      navigation: options.onNavigationEvent,
    };
    const callbacks: JSCallback[] = [];
    for (const { name } of options.messageHandlers) {
      const onMessage = (body: string): void => sinks.messages.get(name)?.(body);
      const callback = new JSCallback(
        (messageRef: Pointer, listenerRef: Pointer | null) =>
          deliverScriptMessage(messageRef, listenerRef, onMessage, s),
        { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
      );
      if (callback.ptr === null) {
        throw new FFIError(`failed to allocate the '${name}' message-handler trampoline`);
      }
      const nameRef = wkString(name);
      s.WKUserContentControllerAddScriptMessageHandler(controller, nameRef, callback.ptr, null);
      wkRelease(nameRef);
      callbacks.push(callback);
    }

    // Main frame only: with no isolated world, an iframe must never get the bridge.
    for (const source of options.userScripts) {
      const sourceRef = wkString(source);
      const userScript = s.WKUserScriptCreateWithSource(sourceRef, WK_INJECT_AT_DOCUMENT_START, 1);
      wkRelease(sourceRef);
      if (userScript !== null) {
        s.WKUserContentControllerAddUserScript(controller, userScript);
        wkRelease(userScript);
      }
    }

    const pageConfig = s.WKPageConfigurationCreate();
    if (pageConfig === null) {
      throw new FFIError('WKPageConfigurationCreate returned NULL');
    }
    s.WKPageConfigurationSetContext(pageConfig, context);
    s.WKPageConfigurationSetUserContentController(pageConfig, controller);

    const hostWindow = createNativeChildHost(options.hwnd, options.width, options.height);

    // RECT{left,top,right,bottom}, passed by hidden pointer (see WKViewCreate in webkit2-ffi.ts).
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

    if (options.onNavigationEvent !== undefined) {
      callbacks.push(...setupNavigationClient(page, (event) => sinks.navigation?.(event)));
    }

    return new WindowsWebView(view, page, hostWindow, controller, callbacks, sinks);
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

  /** Post a synthesized input event to this view's HWND (trusted on WinCairo). */
  sendInputEvent(event: NativeInputEvent): void {
    const hwnd = loadWebKit2().symbols.WKViewGetWindow(this.#view);
    if (hwnd !== 0n) {
      postWindowsInputEvent(hwnd, event, this.#heldButtons);
    }
    this.#heldButtons = heldButtonsAfter(event, this.#heldButtons);
  }

  /**
   * Idempotent. The WKView is never released (D043: that re-enters a JSCallback mid-teardown),
   * so blank the page to stop its scripts, media and sockets until process exit.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const wk = loadWebKit2().symbols;
    // Clear WebKit's clients FIRST: any earlier WebKit call (even stop-loading) re-fires a
    // nav callback into a trampoline mid-teardown and crashes bun:ffi.
    wk.WKPageSetPageNavigationClient(this.#page, null);
    wk.WKUserContentControllerRemoveAllUserMessageHandlers(this.#retainedController);
    // So the blank page runs no preload.
    wk.WKUserContentControllerRemoveAllUserScripts(this.#retainedController);
    this.loadURL('about:blank');
    wkRelease(this.#retainedController);
    this.#sinks.messages.clear();
    this.#sinks.navigation = undefined;
    retainTrampolines(this.#callbacks);
  }
}

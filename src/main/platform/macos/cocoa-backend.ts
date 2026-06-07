import { createLogger } from '../../../common/logger';
import {
  generateChannelId,
  generateIsolatedChannelSetup,
  generateIsolatedHostSource,
  generatePageWorldStub,
} from '../../../renderer/api/cross-world-bridge';
import { generatePreloadBootstrap } from '../../../renderer/preload-bootstrap';
import { CooperativePump } from '../../run-loop';
import type {
  NativeAppKit,
  NativeApplication,
  NativeNavigationEvent,
  NativeWebContents,
  NativeWindow,
  NativeWindowOptions,
  Rect,
  WindowEventType,
} from '../native';
import { buildExecWrapper } from '../../ipc/exec-wrapper';
import { getContentWorld, pageWorld } from './cocoa-content-world';
import { nsString, nsStringToString } from './cocoa-foundation';
import {
  msgSendF64,
  msgSendI64,
  msgSendInitWithContentRect,
  msgSendInitWithFrameConfig,
  msgSendPtr,
  msgSendPtr3,
  msgSendPtr4,
  msgSendPtrI64U8Ptr,
  msgSendPtrPtr,
  msgSendReturnsI64,
  msgSendReturnsU8,
  msgSendSize,
  msgSendU8,
} from './cocoa-msgsend-variants';
import * as cocoaApp from './cocoa-app';
import { createAppDelegate } from './cocoa-app-delegate';
import { createMacOSDrain } from './cocoa-run-loop';
import { cocoa } from './cocoa-runtime';
import { createNavigationDelegate } from './cocoa-navigation-delegate';
import { createUIDelegate } from './cocoa-ui-delegate';
import { createScriptMessageHandler } from './cocoa-script-message-handler';
import { createUrlSchemeHandler } from './cocoa-url-scheme-handler';
import { protocol } from '../../api/protocol';
import { createWindowDelegate } from './cocoa-window-delegate';
import {
  BORDERLESS_WINDOW_STYLE,
  type CocoaWindowStyle,
  computeWindowStyleMask,
  STANDARD_WINDOW_STYLE,
} from './cocoa-style-mask';
import { loadWebKit } from './cocoa-webkit';
import type { Handle } from './objc';

/**
 * The macOS native backend: concrete `NativeApplication` / `NativeWindow` /
 * `NativeWebContents` built on the AppKit + WebKit FFI primitives and the
 * cooperative CF run-loop pump (D020). All Objective-C handles stay as bigints
 * (D016/D029); selectors are resolved through the shared runtime cache.
 */

const log = createLogger('macos-backend');

const NS_BACKING_STORE_BUFFERED = 2n;
const NS_ACTIVATION_POLICY_REGULAR = 0n;
/** `NSWindowStyleMaskFullScreen` (1 << 14). */
const NS_FULLSCREEN_STYLE_MASK = 16384n;
/** `NSFloatingWindowLevel` — above normal windows. */
const NS_FLOATING_WINDOW_LEVEL = 3n;
const WK_INJECTION_TIME_AT_DOCUMENT_START = 0n;
const SCRIPT_MESSAGE_HANDLER_NAME = 'sambar';
/** Page-world handler name `executeJavaScript` posts its result to (D022). */
const EXEC_RESULT_HANDLER_NAME = 'sambarExec';
/** Reject + clear a pending `executeJavaScript` after this long (ms). */
const EXEC_TIMEOUT_MS = 30_000;
/** Name of the isolated `WKContentWorld` the bridge + user preload run in. */
export const PRELOAD_WORLD_NAME = 'SambarPreload';

/** A pending `executeJavaScript` awaiting its page-world result message. */
type PendingExec = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

const dispatchScript = (envelopeJson: string): string =>
  `window.__sambar && window.__sambar._dispatch(${JSON.stringify(envelopeJson)});`;

/**
 * Turn on `developerExtrasEnabled` on a `WKPreferences` via KVC so the inspector
 * is available. Best-effort: the key is undocumented SPI, so a failure to set it
 * must not abort window creation.
 */
const enableDeveloperExtras = (preferences: Handle): void => {
  if (preferences === 0n) {
    return;
  }
  try {
    const rt = cocoa();
    const yes = msgSendU8(rt.classes.get('NSNumber'), rt.selectors.get('numberWithBool:'), 1);
    msgSendPtrPtr(
      preferences,
      rt.selectors.get('setValue:forKey:'),
      yes,
      nsString('developerExtrasEnabled'),
    );
  } catch (error) {
    log.warn('could not enable developer extras', error);
  }
};

/**
 * Register every scheme currently registered with the `protocol` module onto a
 * `WKWebViewConfiguration` via `setURLSchemeHandler:forURLScheme:`. Must run
 * BEFORE the web view is created from this config (WebKit forbids adding a
 * scheme handler afterwards). One shared handler serves all schemes; a failure
 * to register one scheme (e.g. a forbidden/built-in scheme) is logged and
 * skipped so it cannot abort window creation.
 */
const registerCustomSchemes = (configuration: Handle): void => {
  const schemes = protocol.getRegisteredSchemes();
  if (schemes.length === 0) {
    return;
  }
  const rt = cocoa();
  const handler = createUrlSchemeHandler();
  for (const scheme of schemes) {
    try {
      msgSendPtrPtr(
        configuration,
        rt.selectors.get('setURLSchemeHandler:forURLScheme:'),
        handler.handle,
        nsString(scheme),
      );
    } catch (error) {
      log.warn(`could not register custom scheme '${scheme}'`, error);
    }
  }
};

/** The window style mask for the given options: frameless, or standard with optional resizing. */
const styleFromOptions = (options: NativeWindowOptions): CocoaWindowStyle =>
  options.frame === false
    ? BORDERLESS_WINDOW_STYLE
    : { ...STANDARD_WINDOW_STYLE, resizable: options.resizable !== false };

class MacOSWebContents implements NativeWebContents {
  readonly #webview: Handle;
  readonly #isolatedWorld: Handle;
  #envelopeCallback: ((envelopeJson: string) => void) | undefined;
  #navigationCallback: ((event: NativeNavigationEvent) => void) | undefined;
  #windowOpenCallback: ((url: string) => void) | undefined;
  readonly #pendingExecs = new Map<number, PendingExec>();
  #nextExecId = 1;
  #destroyed = false;

  constructor(webview: Handle, isolatedWorld: Handle) {
    this.#webview = webview;
    this.#isolatedWorld = isolatedWorld;
  }

  /** @internal Called by the script message handler with renderer envelopes. */
  deliverRendererEnvelope(envelopeJson: string): void {
    this.#envelopeCallback?.(envelopeJson);
  }

  /**
   * @internal Called by the page-world `sambarExec` handler with the JSON
   * `{ execId, ok, result?, error? }` outcome of an `executeJavaScript` call.
   */
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
    const pending = this.#pendingExecs.get(outcome.execId);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timer);
    this.#pendingExecs.delete(outcome.execId);
    if (outcome.ok) {
      pending.resolve(outcome.result);
    } else {
      pending.reject(new Error(outcome.error ?? 'executeJavaScript failed'));
    }
  }

  /**
   * @internal Mark destroyed and settle every still-pending exec; called on
   * window close BEFORE the web view is torn down. In-flight execs resolve to
   * `undefined` — a normally closed window is not a hard error and a
   * fire-and-forget caller must not receive an unhandled rejection. Any later
   * `executeJavaScript` is rejected by the `#destroyed` guard without touching
   * the freed web view.
   */
  rejectPendingExecs(): void {
    this.#destroyed = true;
    for (const [, pending] of this.#pendingExecs) {
      clearTimeout(pending.timer);
      pending.resolve(undefined);
    }
    this.#pendingExecs.clear();
  }

  /** @internal Called by the navigation delegate for each navigation event. */
  deliverNavigation(event: NativeNavigationEvent): void {
    this.#navigationCallback?.(event);
  }

  /** @internal Called by the UI delegate when the page requests a new window. */
  deliverWindowOpen(url: string): void {
    this.#windowOpenCallback?.(url);
  }

  loadURL(url: string): void {
    const rt = cocoa();
    const nsUrl = msgSendPtr(
      rt.classes.get('NSURL'),
      rt.selectors.get('URLWithString:'),
      nsString(url),
    );
    const request = msgSendPtr(
      rt.classes.get('NSURLRequest'),
      rt.selectors.get('requestWithURL:'),
      nsUrl,
    );
    msgSendPtr(this.#webview, rt.selectors.get('loadRequest:'), request);
  }

  loadHTML(html: string, baseUrl?: string): void {
    const rt = cocoa();
    const base =
      baseUrl === undefined
        ? 0n
        : msgSendPtr(
            rt.classes.get('NSURL'),
            rt.selectors.get('URLWithString:'),
            nsString(baseUrl),
          );
    msgSendPtrPtr(this.#webview, rt.selectors.get('loadHTMLString:baseURL:'), nsString(html), base);
  }

  getURL(): string {
    const rt = cocoa();
    const url = rt.msgSend(this.#webview, rt.selectors.get('URL'));
    if (url === 0n) {
      return '';
    }
    return nsStringToString(rt.msgSend(url, rt.selectors.get('absoluteString')));
  }

  reload(): void {
    cocoa().msgSend(this.#webview, cocoa().selectors.get('reload'));
  }

  goBack(): void {
    cocoa().msgSend(this.#webview, cocoa().selectors.get('goBack'));
  }

  goForward(): void {
    cocoa().msgSend(this.#webview, cocoa().selectors.get('goForward'));
  }

  canGoBack(): boolean {
    return msgSendReturnsU8(this.#webview, cocoa().selectors.get('canGoBack')) === 1;
  }

  canGoForward(): boolean {
    return msgSendReturnsU8(this.#webview, cocoa().selectors.get('canGoForward')) === 1;
  }

  /**
   * Evaluate `code` in the PAGE world (Electron's main world) and resolve to its
   * completion value. A completion-handler block crashes Bun (D022), so the
   * result returns out-of-band: a wrapper runs the code and posts the outcome to
   * the page-world `sambarExec` handler, which settles the matching Promise.
   */
  executeJavaScript(code: string): Promise<unknown> {
    if (this.#destroyed) {
      return Promise.reject(new Error('executeJavaScript failed: web contents destroyed'));
    }
    const execId = this.#nextExecId;
    this.#nextExecId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingExecs.delete(execId);
        reject(new Error(`executeJavaScript timed out after ${EXEC_TIMEOUT_MS}ms`));
      }, EXEC_TIMEOUT_MS);
      this.#pendingExecs.set(execId, { resolve, reject, timer });
      this.#evaluateInWorld(buildExecWrapper(execId, EXEC_RESULT_HANDLER_NAME, code), pageWorld());
    });
  }

  /**
   * Open the web inspector. Developer extras are enabled at view creation, so
   * the inspector is always available via right-click → Inspect Element; this
   * also drives it open programmatically through the private `-[WKWebView
   * _inspector]` + `-[_WKInspector show]` selectors. Those are private SPI: the
   * whole call is best-effort and never throws if the selectors are absent.
   */
  openDevTools(): void {
    try {
      const rt = cocoa();
      const inspector = rt.msgSend(this.#webview, rt.selectors.get('_inspector'));
      if (inspector === 0n) {
        return;
      }
      rt.msgSend(inspector, rt.selectors.get('show'));
    } catch (error) {
      log.warn('openDevTools failed (private inspector SPI unavailable)', error);
    }
  }

  setZoomFactor(factor: number): void {
    msgSendF64(this.#webview, cocoa().selectors.get('setPageZoom:'), factor);
  }

  sendEnvelopeToRenderer(envelopeJson: string): void {
    // Internal dispatch targets the ISOLATED world, where `__sambar` lives.
    this.#evaluateInWorld(dispatchScript(envelopeJson), this.#isolatedWorld);
  }

  /**
   * Evaluate `code` in a specific `WKContentWorld` via
   * `evaluateJavaScript:inFrame:inContentWorld:completionHandler:` (macOS 11+).
   * `frame = 0n` (main frame), completion handler `0n` (fire-and-forget, D022).
   */
  #evaluateInWorld(code: string, world: Handle): void {
    const rt = cocoa();
    msgSendPtr4(
      this.#webview,
      rt.selectors.get('evaluateJavaScript:inFrame:inContentWorld:completionHandler:'),
      nsString(code),
      0n,
      world,
      0n,
    );
  }

  onRendererEnvelope(callback: (envelopeJson: string) => void): void {
    this.#envelopeCallback = callback;
  }

  onNavigation(callback: (event: NativeNavigationEvent) => void): void {
    this.#navigationCallback = callback;
  }

  setWindowOpenHandler(callback: (url: string) => void): void {
    this.#windowOpenCallback = callback;
  }
}

class MacOSWindow implements NativeWindow {
  readonly #window: Handle;
  readonly #contents: MacOSWebContents;
  readonly #teardown: () => void;
  #bounds: Rect;
  #tornDown = false;
  #onClosed: (() => void) | undefined;
  #onClose: (() => boolean) | undefined;
  readonly #eventHandlers = new Map<WindowEventType, () => void>();

  constructor(window: Handle, contents: MacOSWebContents, bounds: Rect, teardown: () => void) {
    this.#window = window;
    this.#contents = contents;
    this.#teardown = teardown;
    this.#bounds = bounds;
  }

  get webContents(): NativeWebContents {
    return this.#contents;
  }

  /**
   * @internal `windowShouldClose:` hook. Consults the registered JS close
   * listener (preventable). Returns true to VETO. Called by the window delegate.
   */
  shouldClose(): boolean {
    return this.#onClose?.() === true;
  }

  /**
   * @internal `windowWillClose:` hook. AppKit has committed to closing on EVERY
   * path here — title-bar button, programmatic `-close`, or `app.quit()`. Run
   * the idempotent teardown (settle pending execs, detach script handlers) so a
   * later `executeJavaScript` can never touch a freed `WKWebView`, then fire the
   * `closed` bookkeeping. THIS is the close-path use-after-free fix.
   */
  willClose(): void {
    if (this.#tornDown) {
      return;
    }
    this.#tornDown = true;
    this.#teardown();
    this.#onClosed?.();
  }

  /** @internal Surface a non-preventable lifecycle event. Called by the delegate. */
  emitEvent(type: WindowEventType): void {
    this.#eventHandlers.get(type)?.();
  }

  setTitle(title: string): void {
    msgSendPtr(this.#window, cocoa().selectors.get('setTitle:'), nsString(title));
  }

  getTitle(): string {
    return nsStringToString(cocoa().msgSend(this.#window, cocoa().selectors.get('title')));
  }

  setSize(width: number, height: number): void {
    msgSendSize(this.#window, cocoa().selectors.get('setContentSize:'), width, height);
    this.#bounds = { ...this.#bounds, width, height };
  }

  getBounds(): Rect {
    return this.#bounds;
  }

  show(): void {
    msgSendPtr(this.#window, cocoa().selectors.get('makeKeyAndOrderFront:'), 0n);
    // AppKit has no `windowDidShow:` notification, so `show` is emitted here. A
    // becomeKey notification also fires `focus` via the delegate.
    this.emitEvent('show');
  }

  hide(): void {
    msgSendPtr(this.#window, cocoa().selectors.get('orderOut:'), 0n);
    this.emitEvent('hide');
  }

  isVisible(): boolean {
    return msgSendReturnsU8(this.#window, cocoa().selectors.get('isVisible')) === 1;
  }

  focus(): void {
    msgSendPtr(this.#window, cocoa().selectors.get('makeKeyAndOrderFront:'), 0n);
  }

  minimize(): void {
    msgSendPtr(this.#window, cocoa().selectors.get('miniaturize:'), 0n);
  }

  maximize(): void {
    if (!this.isMaximized()) {
      msgSendPtr(this.#window, cocoa().selectors.get('zoom:'), 0n);
    }
  }

  unmaximize(): void {
    if (this.isMaximized()) {
      msgSendPtr(this.#window, cocoa().selectors.get('zoom:'), 0n);
    }
  }

  isMaximized(): boolean {
    return msgSendReturnsU8(this.#window, cocoa().selectors.get('isZoomed')) === 1;
  }

  isMinimized(): boolean {
    return msgSendReturnsU8(this.#window, cocoa().selectors.get('isMiniaturized')) === 1;
  }

  restore(): void {
    msgSendPtr(this.#window, cocoa().selectors.get('deminiaturize:'), 0n);
  }

  isFocused(): boolean {
    return msgSendReturnsU8(this.#window, cocoa().selectors.get('isKeyWindow')) === 1;
  }

  isFullScreen(): boolean {
    const styleMask = msgSendReturnsI64(this.#window, cocoa().selectors.get('styleMask'));
    return (styleMask & NS_FULLSCREEN_STYLE_MASK) !== 0n;
  }

  setFullScreen(flag: boolean): void {
    if (flag !== this.isFullScreen()) {
      msgSendPtr(this.#window, cocoa().selectors.get('toggleFullScreen:'), 0n);
    }
  }

  setAlwaysOnTop(flag: boolean): void {
    msgSendI64(
      this.#window,
      cocoa().selectors.get('setLevel:'),
      flag ? NS_FLOATING_WINDOW_LEVEL : 0n,
    );
  }

  close(): void {
    if (this.#tornDown) {
      return;
    }
    // Route through the SAME delegate path the title-bar red button uses:
    // `-performClose:` (NOT `-close`, which bypasses the delegate) triggers
    // `windowShouldClose:` (the veto) then, if allowed, `windowWillClose:`
    // (teardown + `closed`). No teardown here — `willClose()` owns it,
    // idempotently — so a vetoed programmatic close leaves the window fully alive.
    msgSendPtr(this.#window, cocoa().selectors.get('performClose:'), 0n);
  }

  destroy(): void {
    if (this.#tornDown) {
      return;
    }
    // `-close` (not `-performClose:`) fires windowWillClose: (teardown + closed)
    // WITHOUT windowShouldClose:, so it bypasses the preventable veto.
    cocoa().msgSend(this.#window, cocoa().selectors.get('close'));
  }

  onClosed(callback: () => void): void {
    this.#onClosed = callback;
  }

  onClose(callback: () => boolean): void {
    this.#onClose = callback;
  }

  onWindowEvent(type: WindowEventType, callback: () => void): void {
    this.#eventHandlers.set(type, callback);
  }
}

class MacOSApplication implements NativeApplication {
  #started = false;
  #app: Handle = 0n;
  #appDelegate: Handle = 0n;
  #pump: CooperativePump | undefined;
  #readyCallbacks: Array<() => void> = [];
  #onActivate: ((hasVisibleWindows: boolean) => void) | undefined;
  #onOpenUrl: ((url: string) => void) | undefined;
  #onOpenFile: ((path: string) => void) | undefined;

  start(): void {
    if (this.#started) {
      return;
    }
    const rt = cocoa();
    loadWebKit();
    this.#app = rt.msgSend(rt.classes.get('NSApplication'), rt.selectors.get('sharedApplication'));
    // Install the application delegate (Dock-reopen → activate). NSApp holds its
    // delegate weakly, so the +1 from alloc/init (never released) keeps it alive.
    const delegate = createAppDelegate({
      activate: (hasVisibleWindows) => this.#onActivate?.(hasVisibleWindows),
      openUrl: (url) => this.#onOpenUrl?.(url),
      openFile: (path) => this.#onOpenFile?.(path),
    });
    this.#appDelegate = delegate.handle;
    msgSendPtr(this.#app, rt.selectors.get('setDelegate:'), this.#appDelegate);
    msgSendI64(this.#app, rt.selectors.get('setActivationPolicy:'), NS_ACTIVATION_POLICY_REGULAR);
    rt.msgSend(this.#app, rt.selectors.get('finishLaunching'));
    msgSendU8(this.#app, rt.selectors.get('activateIgnoringOtherApps:'), 1);

    this.#pump = new CooperativePump(createMacOSDrain());
    this.#pump.start();
    this.#started = true;
    log.info('application started');

    const callbacks = this.#readyCallbacks;
    this.#readyCallbacks = [];
    for (const callback of callbacks) {
      callback();
    }
  }

  onReady(callback: () => void): void {
    if (this.#started) {
      callback();
    } else {
      this.#readyCallbacks.push(callback);
    }
  }

  onActivate(callback: (hasVisibleWindows: boolean) => void): void {
    this.#onActivate = callback;
  }

  onOpenUrl(callback: (url: string) => void): void {
    this.#onOpenUrl = callback;
  }

  onOpenFile(callback: (path: string) => void): void {
    this.#onOpenFile = callback;
  }

  /** macOS AppKit application operations (activation, hide/show, dock tile). */
  readonly appKit: NativeAppKit = {
    setActivationPolicy: cocoaApp.setActivationPolicy,
    hide: cocoaApp.hide,
    show: cocoaApp.show,
    isHidden: cocoaApp.isHidden,
    isActive: cocoaApp.isActive,
    setDockBadge: cocoaApp.setDockBadge,
    getDockBadge: cocoaApp.getDockBadge,
    bounceDock: cocoaApp.bounceDock,
  };

  showAboutPanel(): void {
    cocoaApp.showAboutPanel();
  }

  createWindow(options: NativeWindowOptions): NativeWindow {
    const rt = cocoa();
    const frame: readonly [number, number, number, number] = [0, 0, options.width, options.height];

    const window = msgSendInitWithContentRect(
      rt.msgSend(rt.classes.get('NSWindow'), rt.selectors.get('alloc')),
      rt.selectors.get('initWithContentRect:styleMask:backing:defer:'),
      frame,
      BigInt(computeWindowStyleMask(styleFromOptions(options))),
      NS_BACKING_STORE_BUFFERED,
      false,
    );

    const configuration = rt.msgSend(
      rt.msgSend(rt.classes.get('WKWebViewConfiguration'), rt.selectors.get('alloc')),
      rt.selectors.get('init'),
    );

    // Enable developer extras so the web inspector is available (right-click →
    // Inspect Element, and webContents.openDevTools()). `developerExtrasEnabled`
    // is a KVC key on WKPreferences; set via setValue:forKey: with an NSNumber.
    enableDeveloperExtras(rt.msgSend(configuration, rt.selectors.get('preferences')));

    // Wire every custom scheme registered via `protocol.handle` onto THIS
    // configuration with `setURLSchemeHandler:forURLScheme:` — it can only be set
    // on the config BEFORE the web view is created (not after). One shared
    // `WKURLSchemeHandler` instance serves all schemes; it routes each request
    // through `protocol.dispatch`. Schemes registered after this window is
    // created are NOT served by it (Electron has the same before-create rule).
    registerCustomSchemes(configuration);

    // The web view (and thus its contents) does not exist until after the
    // configuration is built, so the handler forwards to a late-bound contents
    // reference rather than capturing it directly.
    let contents: MacOSWebContents | undefined;
    const userContentController = rt.msgSend(
      configuration,
      rt.selectors.get('userContentController'),
    );

    // Inject the bridge + user preload into a dedicated isolated world so they
    // are invisible to page scripts (Electron `contextIsolation: true`).
    const isolatedWorld = getContentWorld(PRELOAD_WORLD_NAME);

    const handler = createScriptMessageHandler((envelopeJson) =>
      contents?.deliverRendererEnvelope(envelopeJson),
    );
    // Register the handler IN the isolated world so its `webkit.messageHandlers`
    // binding is reachable only from there.
    msgSendPtr3(
      userContentController,
      rt.selectors.get('addScriptMessageHandler:contentWorld:name:'),
      handler.handle,
      isolatedWorld,
      nsString(SCRIPT_MESSAGE_HANDLER_NAME),
    );

    // Second handler in the PAGE world: the return channel for the public
    // `executeJavaScript`, whose wrapper posts its result here (D022). The page
    // world is a WebKit-interned singleton, so `pageWorld()` returns the same
    // handle at teardown — no need to retain the autoreleased value here.
    const execHandler = createScriptMessageHandler((json) => contents?.deliverExecResult(json));
    msgSendPtr3(
      userContentController,
      rt.selectors.get('addScriptMessageHandler:contentWorld:name:'),
      execHandler.handle,
      pageWorld(),
      nsString(EXEC_RESULT_HANDLER_NAME),
    );

    const addUserScript = (source: string, world: Handle): void => {
      const userScript = msgSendPtrI64U8Ptr(
        rt.msgSend(rt.classes.get('WKUserScript'), rt.selectors.get('alloc')),
        rt.selectors.get('initWithSource:injectionTime:forMainFrameOnly:inContentWorld:'),
        nsString(source),
        WK_INJECTION_TIME_AT_DOCUMENT_START,
        0,
        world,
      );
      msgSendPtr(userContentController, rt.selectors.get('addUserScript:'), userScript);
    };

    // Per-window cross-world channel id for contextBridge (Phase B). The page
    // stub and the isolated host both bake it in at inject time.
    const channelId = generateChannelId();

    // Isolated world: record the channel id, then the bridge, then the
    // contextBridge host (installs `__sambar.exposeInMainWorld`), then the user
    // preload — so `window.__sambar` + the channel + exposeInMainWorld all exist
    // when the user preload runs and calls exposeInMainWorld.
    addUserScript(generateIsolatedChannelSetup(channelId), isolatedWorld);
    addUserScript(generatePreloadBootstrap(), isolatedWorld);
    addUserScript(generateIsolatedHostSource(channelId), isolatedWorld);
    if (options.preloadScript !== undefined) {
      addUserScript(options.preloadScript, isolatedWorld);
    }
    // Page world: the cross-world stub that materialises contextBridge surfaces.
    addUserScript(generatePageWorldStub(channelId), pageWorld());

    const webview = msgSendInitWithFrameConfig(
      rt.msgSend(rt.classes.get('WKWebView'), rt.selectors.get('alloc')),
      rt.selectors.get('initWithFrame:configuration:'),
      frame,
      configuration,
    );
    contents = new MacOSWebContents(webview, isolatedWorld);

    // Forward-declared so the navigation + window delegate closures can reference
    // it; assigned once the teardown closure (below) exists. The closures only
    // run on later native callbacks, after the assignment.
    let nativeWindow: MacOSWindow;

    // `ready-to-show` is emitted once, on the FIRST finished load, reusing the
    // navigation delegate's did-finish-load signal.
    let readyToShowEmitted = false;
    const navigationDelegate = createNavigationDelegate((event) => {
      contents?.deliverNavigation(event);
      if (event.type === 'did-finish-load' && !readyToShowEmitted) {
        readyToShowEmitted = true;
        nativeWindow.emitEvent('ready-to-show');
      }
    });
    msgSendPtr(webview, rt.selectors.get('setNavigationDelegate:'), navigationDelegate.handle);

    // WKUIDelegate: route window.open / target=_blank to the JS handler (returns
    // nil so no child web view is created). Retained by its registry, like the
    // nav delegate.
    const uiDelegate = createUIDelegate((url) => contents?.deliverWindowOpen(url));
    msgSendPtr(webview, rt.selectors.get('setUIDelegate:'), uiDelegate.handle);

    msgSendPtr(window, rt.selectors.get('setContentView:'), webview);
    msgSendPtr(window, rt.selectors.get('setTitle:'), nsString(options.title));

    // Teardown run on window close: detach both handlers from their worlds, drop
    // their registry entries + release the native instances, and reject any
    // exec Promise still awaiting a result it can no longer receive.
    const teardown = (): void => {
      msgSendPtrPtr(
        userContentController,
        rt.selectors.get('removeScriptMessageHandlerForName:contentWorld:'),
        nsString(SCRIPT_MESSAGE_HANDLER_NAME),
        isolatedWorld,
      );
      handler.dispose();
      msgSendPtrPtr(
        userContentController,
        rt.selectors.get('removeScriptMessageHandlerForName:contentWorld:'),
        nsString(EXEC_RESULT_HANDLER_NAME),
        pageWorld(),
      );
      execHandler.dispose();
      contents?.rejectPendingExecs();
    };

    nativeWindow = new MacOSWindow(
      window,
      contents,
      {
        x: 0,
        y: 0,
        width: options.width,
        height: options.height,
      },
      teardown,
    );

    // Set the NSWindowDelegate: it routes `windowShouldClose:` (the preventable
    // veto) and `windowWillClose:` (teardown + `closed`) plus the key/resize/
    // miniaturize lifecycle notifications into the window. The delegate's IMP
    // JSCallbacks are retained for the process lifetime by `defineObjcClass`, so
    // they are never freed inside their own invocation (JSCallback discipline).
    const windowDelegate = createWindowDelegate({
      shouldClose: () => nativeWindow.shouldClose(),
      willClose: () => nativeWindow.willClose(),
      event: (type) => nativeWindow.emitEvent(type),
    });
    msgSendPtr(window, rt.selectors.get('setDelegate:'), windowDelegate.handle);

    if (options.fullscreen === true) {
      nativeWindow.setFullScreen(true);
    }
    if (options.show) {
      nativeWindow.show();
    }
    return nativeWindow;
  }

  quit(): void {
    this.#pump?.stop();
    this.#pump = undefined;
    this.#started = false;
  }
}

/** Create the macOS native application backend. Call `start()` before use. */
export const createMacOSApplication = (): NativeApplication => new MacOSApplication();

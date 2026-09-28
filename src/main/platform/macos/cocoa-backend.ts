import { FFIType, ptr } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { createLogger } from '../../../common/logger';
import {
  generateChannelId,
  generateIsolatedChannelSetup,
  generateIsolatedHostSource,
  generatePageWorldStub,
} from '../../../renderer/api/cross-world-bridge';
import { generatePreloadBootstrap } from '../../../renderer/preload-bootstrap';
import { protocol } from '../../api/protocol';
import { isDevRestart } from '../../dev-reload';
import { buildExecWrapper, EXEC_TIMEOUT_MS } from '../../ipc/exec-wrapper';
import { AdaptiveBlockingPump } from '../../run-loop';
import { DOM_READY_HANDLER_NAME, generateDomReadyScript } from '../dom-ready';
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
import { windowControlsScript } from '../window-controls';
import * as cocoaApp from './cocoa-app';
import { createAppDelegate } from './cocoa-app-delegate';
import { makeOneShotBlock } from './cocoa-block';
import { getContentWorld, pageWorld } from './cocoa-content-world';
import { nsString, nsStringToString } from './cocoa-foundation';
import { cancelMenuTracking, popUpMenu } from './cocoa-menu';
import {
  msgSendF64,
  msgSendI64,
  msgSendI64Ptr,
  msgSendInitWithContentRect,
  msgSendInitWithFrameConfig,
  msgSendPtr,
  msgSendPtr3,
  msgSendPtr4,
  msgSendPtrI64U8Ptr,
  msgSendPtrI64,
  msgSendPtrPtr,
  msgSendPtrReturnsU8,
  msgSendRectU8,
  msgSendReturnsI64,
  msgSendReturnsU8,
  msgSendSize,
  msgSendU8,
} from './cocoa-msgsend-variants';
import { nsDataToBytes } from './cocoa-native-image';
import { createNavigationDelegate } from './cocoa-navigation-delegate';
import { createMacOSDrain } from './cocoa-run-loop';
import { primaryDisplayHeight } from './cocoa-screen';
import { createScriptMessageHandler } from './cocoa-script-message-handler';
import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import {
  type CocoaWindowStyle,
  computeWindowStyleMask,
  STANDARD_WINDOW_STYLE,
} from './cocoa-style-mask';
import { createUIDelegate } from './cocoa-ui-delegate';
import { createUrlSchemeHandler } from './cocoa-url-scheme-handler';
import { loadWebKit } from './cocoa-webkit';
import { createWindowDelegate } from './cocoa-window-delegate';
import type { Handle } from './objc';

const log = createLogger('macos-backend');

const NS_BACKING_STORE_BUFFERED = 2n;
const NS_ACTIVATION_POLICY_REGULAR = 0n;

/** `NSEventMaskAny` (NSUIntegerMax): dequeue every kind of AppKit event. */
const NS_EVENT_MASK_ANY: Handle = 0xffffffffffffffffn;
const DEQUEUE_YES: Handle = 1n;
/** Upper bound on events dispatched per pump tick, so a flood can't starve Bun. */
const APP_EVENT_BUDGET = 256;
/** `NSWindowStyleMaskFullScreen` (1 << 14). */
const NS_FULLSCREEN_STYLE_MASK = 16384n;
/** `NSWindowStyleMaskResizable` (1 << 3). */
const NS_RESIZABLE_STYLE_MASK = 8n;
/** `NSBitmapImageFileTypePNG`. */
const NS_BITMAP_FILE_TYPE_PNG = 4n;

/** Encode an `NSImage` to PNG bytes via `NSBitmapImageRep` (empty on failure). */
const nsImageToPng = (image: Handle): Uint8Array => {
  const rt = cocoa();
  const tiff = rt.msgSend(image, rt.selectors.get('TIFFRepresentation'));
  if (tiff === 0n) {
    return new Uint8Array(0);
  }
  const rep = msgSendPtr(
    rt.classes.get('NSBitmapImageRep'),
    rt.selectors.get('imageRepWithData:'),
    tiff,
  );
  if (rep === 0n) {
    return new Uint8Array(0);
  }
  const props = rt.msgSend(rt.classes.get('NSDictionary'), rt.selectors.get('dictionary'));
  const png = msgSendI64Ptr(
    rep,
    rt.selectors.get('representationUsingType:properties:'),
    NS_BITMAP_FILE_TYPE_PNG,
    props,
  );
  return nsDataToBytes(png);
};
/** `NSFloatingWindowLevel`. */
const NS_FLOATING_WINDOW_LEVEL = 3n;
const WK_INJECTION_TIME_AT_DOCUMENT_START = 0n;
/** Electron runs preloads in the main frame only; an iframe must never get the bridge. */
const FOR_MAIN_FRAME_ONLY = 1;
const SCRIPT_MESSAGE_HANDLER_NAME = 'bunmaska';
/** Page-world handler name `executeJavaScript` posts its result to (D022). */
const EXEC_RESULT_HANDLER_NAME = 'bunmaskaExec';
/** Milliseconds before a pending printToPDF/capturePage rejects. */
const RENDER_TIMEOUT_MS = 30_000;
/** Name of the isolated `WKContentWorld` the bridge + user preload run in. */
export const PRELOAD_WORLD_NAME = 'BunmaskaPreload';

/** A pending `executeJavaScript` awaiting its page-world result message. */
type PendingExec = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

const dispatchScript = (envelopeJson: string): string =>
  `window.__bunmaska && window.__bunmaska._dispatch(${JSON.stringify(envelopeJson)});`;

/** Enable the inspector through the undocumented `developerExtrasEnabled` KVC key; best-effort. */
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

/** One stateless handler serves every scheme of every window. */
let schemeHandler: Handle | undefined;

/** RFC 3986 scheme syntax. */
const VALID_SCHEME = /^[a-z][a-z0-9+.-]*$/;

/**
 * Put every `protocol.handle` scheme on `configuration`; WebKit only accepts
 * scheme handlers before the web view exists. `setURLSchemeHandler:` raises an
 * NSException for a scheme WebKit handles itself (https, file, ...) or a
 * malformed one, and an NSException aborts Bun past any JS catch, so those are
 * skipped up front.
 */
const registerCustomSchemes = (configuration: Handle): void => {
  const schemes = protocol.getRegisteredSchemes();
  if (schemes.length === 0) {
    return;
  }
  const rt = cocoa();
  schemeHandler ??= createUrlSchemeHandler().handle;
  for (const scheme of schemes) {
    const unsupported =
      !VALID_SCHEME.test(scheme) ||
      msgSendPtrReturnsU8(
        rt.classes.get('WKWebView'),
        rt.selectors.get('handlesURLScheme:'),
        nsString(scheme),
      ) === 1;
    if (unsupported) {
      log.warn(`protocol.handle('${scheme}') is ignored on macOS: WebKit cannot intercept it`);
      continue;
    }
    msgSendPtrPtr(
      configuration,
      rt.selectors.get('setURLSchemeHandler:forURLScheme:'),
      schemeHandler,
      nsString(scheme),
    );
  }
};

const styleFromOptions = (options: NativeWindowOptions): CocoaWindowStyle => ({
  ...STANDARD_WINDOW_STYLE,
  titled: options.frame !== false,
  resizable: options.resizable !== false,
});

let framelessWindowClass: Handle | undefined;

/**
 * An NSWindow for frame: false. Without a title bar AppKit answers NO to becoming
 * key or main, and -performClose: only beeps, so both are overridden.
 */
const ensureFramelessWindowClass = (): Handle => {
  framelessWindowClass ??= defineObjcClass('BunmaskaFramelessWindow', 'NSWindow', [
    {
      selector: 'canBecomeKeyWindow',
      typeEncoding: 'c@:',
      args: [],
      returns: 'bool',
      impl: () => 1,
    },
    {
      selector: 'canBecomeMainWindow',
      typeEncoding: 'c@:',
      args: [],
      returns: 'bool',
      impl: () => 1,
    },
    {
      selector: 'performClose:',
      typeEncoding: 'v@:@',
      args: ['object'],
      impl: (self) => {
        const rt = cocoa();
        const delegate = rt.msgSend(self, rt.selectors.get('delegate'));
        const allowed =
          delegate === 0n ||
          msgSendPtrReturnsU8(delegate, rt.selectors.get('windowShouldClose:'), self) === 1;
        if (allowed) {
          rt.msgSend(self, rt.selectors.get('close'));
        }
      },
    },
  ]);
  return framelessWindowClass;
};

class MacOSWebContents implements NativeWebContents {
  #webview: Handle;
  readonly #isolatedWorld: Handle;
  #envelopeCallback: ((envelopeJson: string) => void) | undefined;
  #didFinishLoad = false;
  readonly #pendingEnvelopes: string[] = [];
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
   * @internal Called by the page-world `bunmaskaExec` handler with the JSON
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
   * @internal Close-path teardown. In-flight execs resolve to `undefined`: a
   * closed window is not an error, and a fire-and-forget caller must not get an
   * unhandled rejection.
   */
  rejectPendingExecs(): void {
    this.#destroyed = true;
    // Messaging nil is a no-op, so every later call is safe once the view is released.
    this.#webview = 0n;
    for (const [, pending] of this.#pendingExecs) {
      clearTimeout(pending.timer);
      pending.resolve(undefined);
    }
    this.#pendingExecs.clear();
  }

  /** @internal Called by the navigation delegate for each navigation event. */
  deliverNavigation(event: NativeNavigationEvent): void {
    // Sends before the first finished load are queued, not dropped (same contract as Linux).
    if (event.type === 'did-finish-load' && !this.#didFinishLoad) {
      this.#didFinishLoad = true;
      const queued = [...this.#pendingEnvelopes];
      this.#pendingEnvelopes.length = 0;
      for (const json of queued) {
        this.#evaluateInWorld(dispatchScript(json), this.#isolatedWorld);
      }
    }
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

  getTitle(): string {
    return nsStringToString(cocoa().msgSend(this.#webview, cocoa().selectors.get('title')));
  }

  reload(): void {
    cocoa().msgSend(this.#webview, cocoa().selectors.get('reload'));
  }

  reloadIgnoringCache(): void {
    cocoa().msgSend(this.#webview, cocoa().selectors.get('reloadFromOrigin'));
  }

  stop(): void {
    cocoa().msgSend(this.#webview, cocoa().selectors.get('stopLoading'));
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
   * Evaluate `code` in the page world (Electron's main world). The result comes
   * back through the page-world `bunmaskaExec` handler, not a completion block (D022).
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

  /** PDF bytes from `createPDFWithConfiguration:completionHandler:` (a D022b block). */
  printToPDF(): Promise<Uint8Array> {
    if (this.#destroyed) {
      return Promise.reject(new Error('printToPDF failed: web contents destroyed'));
    }
    return new Promise<Uint8Array>((resolve, reject) => {
      // WebKit still calls the block later (nil on close), so a timeout only rejects.
      const timer = setTimeout(() => {
        reject(new Error(`printToPDF timed out after ${RENDER_TIMEOUT_MS}ms`));
      }, RENDER_TIMEOUT_MS);
      const block = makeOneShotBlock(
        (pdfData, error) => {
          clearTimeout(timer);
          const data = BigInt(pdfData ?? 0);
          if (data === 0n) {
            reject(new Error(`printToPDF failed (NSError ${error ?? 'nil'})`));
            return;
          }
          resolve(nsDataToBytes(data));
        },
        [FFIType.ptr, FFIType.ptr],
      );
      msgSendPtrPtr(
        this.#webview,
        cocoa().selectors.get('createPDFWithConfiguration:completionHandler:'),
        0n,
        block,
      );
    });
  }

  /** PNG bytes from `takeSnapshotWithConfiguration:completionHandler:` (a D022b block). */
  capturePage(): Promise<Uint8Array> {
    if (this.#destroyed) {
      return Promise.reject(new Error('capturePage failed: web contents destroyed'));
    }
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`capturePage timed out after ${RENDER_TIMEOUT_MS}ms`));
      }, RENDER_TIMEOUT_MS);
      const block = makeOneShotBlock(
        (image, error) => {
          clearTimeout(timer);
          const img = BigInt(image ?? 0);
          if (img === 0n) {
            reject(new Error(`capturePage failed (NSError ${error ?? 'nil'})`));
            return;
          }
          try {
            resolve(nsImageToPng(img));
          } catch (cause) {
            reject(cause instanceof Error ? cause : new Error(String(cause)));
          }
        },
        [FFIType.ptr, FFIType.ptr],
      );
      msgSendPtrPtr(
        this.#webview,
        cocoa().selectors.get('takeSnapshotWithConfiguration:completionHandler:'),
        0n,
        block,
      );
    });
  }

  sendInputEvent(): void {
    throw new UnsupportedPlatformError('webContents.sendInputEvent is not yet supported on macOS');
  }

  /** Show the inspector through the private `-[WKWebView _inspector]` SPI; never throws. */
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

  closeDevTools(): void {
    try {
      const rt = cocoa();
      const inspector = rt.msgSend(this.#webview, rt.selectors.get('_inspector'));
      if (inspector === 0n) {
        return;
      }
      rt.msgSend(inspector, rt.selectors.get('close'));
    } catch (error) {
      log.warn('closeDevTools failed (private inspector SPI unavailable)', error);
    }
  }

  setZoomFactor(factor: number): void {
    msgSendF64(this.#webview, cocoa().selectors.get('setPageZoom:'), factor);
  }

  setUserAgent(userAgent: string): void {
    // Takes effect on the next navigation.
    msgSendPtr(this.#webview, cocoa().selectors.get('setCustomUserAgent:'), nsString(userAgent));
  }

  sendEnvelopeToRenderer(envelopeJson: string): void {
    if (this.#destroyed) {
      return;
    }
    if (!this.#didFinishLoad) {
      this.#pendingEnvelopes.push(envelopeJson);
      return;
    }
    // Internal dispatch targets the ISOLATED world, where `__bunmaska` lives.
    this.#evaluateInWorld(dispatchScript(envelopeJson), this.#isolatedWorld);
  }

  /** Fire-and-forget in `world`'s main frame: nil frame, nil completion handler (D022). */
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
  #window: Handle;
  readonly #contents: MacOSWebContents;
  readonly #teardown: () => void;
  readonly #releaseNative: () => void;
  #tornDown = false;
  #onClosed: (() => void) | undefined;
  #onClose: (() => boolean) | undefined;
  #activePopupMenu: Handle = 0n;
  #zoomed = false;
  readonly #eventHandlers = new Map<WindowEventType, () => void>();

  constructor(
    window: Handle,
    contents: MacOSWebContents,
    teardown: () => void,
    releaseNative: () => void,
  ) {
    this.#window = window;
    this.#contents = contents;
    this.#teardown = teardown;
    this.#releaseNative = releaseNative;
  }

  get webContents(): NativeWebContents {
    return this.#contents;
  }

  /** @internal `windowShouldClose:` hook; true vetoes the close. */
  shouldClose(): boolean {
    return this.#onClose?.() === true;
  }

  /**
   * @internal `windowWillClose:` hook, reached on every AppKit close path
   * (title-bar button, performClose:, -close). Tears down before any listener
   * runs, so nothing touches the web view after it.
   */
  willClose(): void {
    if (this.#tornDown) {
      return;
    }
    this.#tornDown = true;
    // Messaging nil is a no-op, so every later call is safe once the window is released.
    this.#window = 0n;
    // Release our +1s a tick later: AppKit's -close is still on the stack here.
    // Scheduled first, so a throwing listener cannot skip it.
    setTimeout(this.#releaseNative, 0);
    this.#teardown();
    this.#onClosed?.();
  }

  /** @internal Surface a non-preventable lifecycle event. Called by the delegate. */
  emitEvent(type: WindowEventType): void {
    if (this.#tornDown) {
      return;
    }
    // AppKit posts no zoom notification, so maximize/unmaximize are derived by
    // diffing isZoomed across resizes - the only hook that fires on both.
    if (type === 'resize') {
      const zoomed = this.isMaximized();
      if (zoomed !== this.#zoomed) {
        this.#zoomed = zoomed;
        this.emitEvent(zoomed ? 'maximize' : 'unmaximize');
      }
    }
    this.#eventHandlers.get(type)?.();
  }

  setTitle(title: string): void {
    msgSendPtr(this.#window, cocoa().selectors.get('setTitle:'), nsString(title));
  }

  getTitle(): string {
    return nsStringToString(cocoa().msgSend(this.#window, cocoa().selectors.get('title')));
  }

  /** Set the FRAME rect from a top-left global rect (Electron's space). */
  #setFrameTopLeft(rect: Rect): void {
    const bottomLeftY = primaryDisplayHeight() - rect.y - rect.height;
    msgSendRectU8(
      this.#window,
      cocoa().selectors.get('setFrame:display:'),
      [rect.x, bottomLeftY, rect.width, rect.height],
      true,
    );
  }

  /**
   * The FRAME rect, top-left global. `-frame` returns a struct by value (D018), so
   * it is read through KVC into an out buffer. Unlike the window-server list, this
   * is current right after setFrame: and for a never-shown window.
   */
  #frame(): Rect {
    if (this.#tornDown) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const rt = cocoa();
    const value = msgSendPtr(this.#window, rt.selectors.get('valueForKey:'), nsString('frame'));
    const out = new Float64Array(4);
    msgSendPtrI64(
      value,
      rt.selectors.get('getValue:size:'),
      BigInt(ptr(out)),
      BigInt(out.byteLength),
    );
    const [x = 0, y = 0, width = 0, height = 0] = out;
    return { x, y: primaryDisplayHeight() - y - height, width, height };
  }

  setSize(width: number, height: number): void {
    // Electron's setSize is the WINDOW (frame) size; keep the top-left anchored.
    const current = this.#frame();
    this.#setFrameTopLeft({ x: current.x, y: current.y, width, height });
  }

  setPosition(x: number, y: number): void {
    const current = this.#frame();
    this.#setFrameTopLeft({ x, y, width: current.width, height: current.height });
  }

  setBounds(bounds: Rect): void {
    this.#setFrameTopLeft(bounds);
  }

  getBounds(): Rect {
    return this.#frame();
  }

  setResizable(resizable: boolean): void {
    const mask = msgSendReturnsI64(this.#window, cocoa().selectors.get('styleMask'));
    const next = resizable ? mask | NS_RESIZABLE_STYLE_MASK : mask & ~NS_RESIZABLE_STYLE_MASK;
    msgSendI64(this.#window, cocoa().selectors.get('setStyleMask:'), next);
  }

  setOpacity(opacity: number): void {
    msgSendF64(this.#window, cocoa().selectors.get('setAlphaValue:'), opacity);
  }

  setMinimumSize(width: number, height: number): void {
    // NSSize shares the NSPoint/NSSize 2-double ABI used by msgSendSize.
    msgSendSize(this.#window, cocoa().selectors.get('setContentMinSize:'), width, height);
  }

  center(): void {
    cocoa().msgSend(this.#window, cocoa().selectors.get('center'));
  }

  show(): void {
    if (this.#tornDown) {
      return;
    }
    const rt = cocoa();
    if (isDevRestart()) {
      // A dev respawn orders the window in behind the editor instead of on top.
      msgSendPtr(this.#window, rt.selectors.get('orderFront:'), 0n);
    } else {
      msgSendPtr(this.#window, rt.selectors.get('makeKeyAndOrderFront:'), 0n);
      const app = rt.msgSend(
        rt.classes.get('NSApplication'),
        rt.selectors.get('sharedApplication'),
      );
      msgSendU8(app, rt.selectors.get('activateIgnoringOtherApps:'), 1);
    }
    // AppKit has no windowDidShow: notification; focus arrives via windowDidBecomeKey:.
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
    // Electron: a no-op while hidden, and activates the app only when none is active.
    if (!this.isVisible()) {
      return;
    }
    const rt = cocoa();
    const app = rt.msgSend(rt.classes.get('NSApplication'), rt.selectors.get('sharedApplication'));
    msgSendU8(app, rt.selectors.get('activateIgnoringOtherApps:'), 0);
    msgSendPtr(this.#window, rt.selectors.get('makeKeyAndOrderFront:'), 0n);
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
    // performClose: asks windowShouldClose: (the veto) like the title-bar button;
    // -close would skip it. willClose() owns the teardown.
    msgSendPtr(this.#window, cocoa().selectors.get('performClose:'), 0n);
  }

  destroy(): void {
    if (this.#tornDown) {
      return;
    }
    // -close skips windowShouldClose:, so the veto cannot stop it.
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

  popupMenu(menuHandle: bigint, x: number, y: number): void {
    const view = cocoa().msgSend(this.#window, cocoa().selectors.get('contentView'));
    if (view === 0n) {
      return;
    }
    this.#activePopupMenu = menuHandle;
    try {
      popUpMenu(menuHandle, view, x, y); // BLOCKS until the user picks an item or dismisses.
    } finally {
      this.#activePopupMenu = 0n;
    }
  }

  closePopupMenu(): void {
    if (this.#activePopupMenu !== 0n) {
      cancelMenuTracking(this.#activePopupMenu);
    }
  }
}

class MacOSApplication implements NativeApplication {
  #started = false;
  #app: Handle = 0n;
  #appDelegate: Handle = 0n;
  #pump: AdaptiveBlockingPump | undefined;
  #readyCallbacks: Array<() => void> = [];
  #onActivate: ((hasVisibleWindows: boolean) => void) | undefined;
  #onOpenUrl: ((url: string) => void) | undefined;
  #onOpenFile: ((path: string) => void) | undefined;
  #onQuitRequest: (() => void) | undefined;
  // Cached arguments for the per-tick AppKit event pump.
  #nextEventSel: Handle = 0n;
  #sendEventSel: Handle = 0n;
  #distantPast: Handle = 0n;
  #eventPumpMode: Handle = 0n;

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
      quitRequested: () => this.#onQuitRequest?.(),
    });
    this.#appDelegate = delegate.handle;
    msgSendPtr(this.#app, rt.selectors.get('setDelegate:'), this.#appDelegate);
    msgSendI64(this.#app, rt.selectors.get('setActivationPolicy:'), NS_ACTIVATION_POLICY_REGULAR);
    rt.msgSend(this.#app, rt.selectors.get('finishLaunching'));
    if (!isDevRestart()) {
      msgSendU8(this.#app, rt.selectors.get('activateIgnoringOtherApps:'), 1);
    }

    // The mode string is autoreleased; retain it for the app's lifetime.
    this.#nextEventSel = rt.selectors.get('nextEventMatchingMask:untilDate:inMode:dequeue:');
    this.#sendEventSel = rt.selectors.get('sendEvent:');
    this.#distantPast = rt.msgSend(rt.classes.get('NSDate'), rt.selectors.get('distantPast'));
    this.#eventPumpMode = rt.msgSend(nsString('kCFRunLoopDefaultMode'), rt.selectors.get('retain'));

    this.#pump = new AdaptiveBlockingPump(createMacOSDrain(() => this.#pumpAppEvents()));
    this.#pump.start();
    this.#started = true;
    log.info('application started');

    const callbacks = this.#readyCallbacks;
    this.#readyCallbacks = [];
    for (const callback of callbacks) {
      callback();
    }
  }

  /** Dispatch queued AppKit input events without blocking (untilDate: distantPast). */
  #pumpAppEvents(): void {
    if (this.#app === 0n) {
      return;
    }
    for (let i = 0; i < APP_EVENT_BUDGET; i += 1) {
      const event = msgSendPtr4(
        this.#app,
        this.#nextEventSel,
        NS_EVENT_MASK_ANY,
        this.#distantPast,
        this.#eventPumpMode,
        DEQUEUE_YES,
      );
      if (event === 0n) {
        break;
      }
      msgSendPtr(this.#app, this.#sendEventSel, event);
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

  onQuitRequest(callback: () => void): void {
    this.#onQuitRequest = callback;
  }

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

    const windowClass =
      options.frame === false ? ensureFramelessWindowClass() : rt.classes.get('NSWindow');
    const window = msgSendInitWithContentRect(
      rt.msgSend(windowClass, rt.selectors.get('alloc')),
      rt.selectors.get('initWithContentRect:styleMask:backing:defer:'),
      frame,
      BigInt(computeWindowStyleMask(styleFromOptions(options))),
      NS_BACKING_STORE_BUFFERED,
      false,
    );

    // releasedWhenClosed:YES (the default) frees the window under our handle on
    // close; releaseNative balances our +1 instead.
    msgSendU8(window, rt.selectors.get('setReleasedWhenClosed:'), 0);
    // Electron's default placement.
    rt.msgSend(window, rt.selectors.get('center'));

    const configuration = rt.msgSend(
      rt.msgSend(rt.classes.get('WKWebViewConfiguration'), rt.selectors.get('alloc')),
      rt.selectors.get('init'),
    );

    enableDeveloperExtras(rt.msgSend(configuration, rt.selectors.get('preferences')));

    // A scheme handled after this window exists is not served by it (Electron's rule too).
    registerCustomSchemes(configuration);

    // The handlers exist before the web view, so they reach its contents late-bound.
    let contents: MacOSWebContents | undefined;
    const userContentController = rt.msgSend(
      configuration,
      rt.selectors.get('userContentController'),
    );

    // The bridge and preload run in an isolated world, invisible to page scripts.
    const isolatedWorld = getContentWorld(PRELOAD_WORLD_NAME);

    const handler = createScriptMessageHandler((envelopeJson) =>
      contents?.deliverRendererEnvelope(envelopeJson),
    );
    // Only the isolated world can reach this handler.
    msgSendPtr3(
      userContentController,
      rt.selectors.get('addScriptMessageHandler:contentWorld:name:'),
      handler.handle,
      isolatedWorld,
      nsString(SCRIPT_MESSAGE_HANDLER_NAME),
    );

    // executeJavaScript's return channel (D022). pageWorld() is interned by WebKit,
    // so teardown gets the same handle without a retain here.
    const execHandler = createScriptMessageHandler((json) => contents?.deliverExecResult(json));
    msgSendPtr3(
      userContentController,
      rt.selectors.get('addScriptMessageHandler:contentWorld:name:'),
      execHandler.handle,
      pageWorld(),
      nsString(EXEC_RESULT_HANDLER_NAME),
    );

    // The page world's DOMContentLoaded surfaces Electron's dom-ready.
    const domReadyHandler = createScriptMessageHandler(() =>
      contents?.deliverNavigation({ type: 'dom-ready' }),
    );
    msgSendPtr3(
      userContentController,
      rt.selectors.get('addScriptMessageHandler:contentWorld:name:'),
      domReadyHandler.handle,
      pageWorld(),
      nsString(DOM_READY_HANDLER_NAME),
    );

    const addUserScript = (source: string, world: Handle): void => {
      const userScript = msgSendPtrI64U8Ptr(
        rt.msgSend(rt.classes.get('WKUserScript'), rt.selectors.get('alloc')),
        rt.selectors.get('initWithSource:injectionTime:forMainFrameOnly:inContentWorld:'),
        nsString(source),
        WK_INJECTION_TIME_AT_DOCUMENT_START,
        FOR_MAIN_FRAME_ONLY,
        world,
      );
      msgSendPtr(userContentController, rt.selectors.get('addUserScript:'), userScript);
      rt.msgSend(userScript, rt.selectors.get('release'));
    };

    const channelId = generateChannelId();
    // Order matters: exposeInMainWorld must exist before the user preload runs.
    addUserScript(generateIsolatedChannelSetup(channelId), isolatedWorld);
    addUserScript(generatePreloadBootstrap(), isolatedWorld);
    addUserScript(generateIsolatedHostSource(channelId), isolatedWorld);
    if (options.preloadScript !== undefined) {
      addUserScript(options.preloadScript, isolatedWorld);
    }
    addUserScript(generatePageWorldStub(channelId), pageWorld());
    // Never put __bunmaska in the page world: it would defeat context isolation.
    // ponytail: --app-region mirror only; window-op controls wait for the isolated bridge (D045)
    addUserScript(windowControlsScript(), pageWorld());
    addUserScript(generateDomReadyScript(), pageWorld());

    const webview = msgSendInitWithFrameConfig(
      rt.msgSend(rt.classes.get('WKWebView'), rt.selectors.get('alloc')),
      rt.selectors.get('initWithFrame:configuration:'),
      frame,
      configuration,
    );
    // The web view copies the configuration; the copy shares its user content controller.
    rt.msgSend(configuration, rt.selectors.get('release'));
    contents = new MacOSWebContents(webview, isolatedWorld);

    // Assigned below; the delegate closures only run on later native callbacks.
    let nativeWindow: MacOSWindow;

    let readyToShowEmitted = false;
    const navigationDelegate = createNavigationDelegate((event) => {
      contents?.deliverNavigation(event);
      if (event.type === 'did-finish-load' && !readyToShowEmitted) {
        readyToShowEmitted = true;
        nativeWindow.emitEvent('ready-to-show');
      }
    });
    msgSendPtr(webview, rt.selectors.get('setNavigationDelegate:'), navigationDelegate.handle);

    // window.open and target=_blank go to the JS handler; nil means no child view.
    const uiDelegate = createUIDelegate((url) => contents?.deliverWindowOpen(url));
    msgSendPtr(webview, rt.selectors.get('setUIDelegate:'), uiDelegate.handle);

    msgSendPtr(window, rt.selectors.get('setContentView:'), webview);
    msgSendPtr(window, rt.selectors.get('setTitle:'), nsString(options.title));

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
      msgSendPtrPtr(
        userContentController,
        rt.selectors.get('removeScriptMessageHandlerForName:contentWorld:'),
        nsString(DOM_READY_HANDLER_NAME),
        pageWorld(),
      );
      domReadyHandler.dispose();
      contents?.rejectPendingExecs();
    };

    // Detach the delegate before releasing, so no late notification fires.
    const releaseNative = (): void => {
      msgSendPtr(window, rt.selectors.get('setDelegate:'), 0n);
      navigationDelegate.destroy();
      uiDelegate.destroy();
      windowDelegate.destroy();
      cocoa().msgSend(webview, rt.selectors.get('release'));
      cocoa().msgSend(window, rt.selectors.get('release'));
    };

    nativeWindow = new MacOSWindow(window, contents, teardown, releaseNative);

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

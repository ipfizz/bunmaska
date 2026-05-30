import { createLogger } from '../../../common/logger';
import { generatePreloadBootstrap } from '../../../renderer/preload-bootstrap';
import { CooperativePump } from '../../run-loop';
import type {
  NativeApplication,
  NativeWebContents,
  NativeWindow,
  NativeWindowOptions,
  Rect,
} from '../native';
import { nsString, nsStringToString } from './cocoa-foundation';
import {
  msgSendI64,
  msgSendInitWithContentRect,
  msgSendInitWithFrameConfig,
  msgSendPtr,
  msgSendPtrI64U8,
  msgSendPtrPtr,
  msgSendReturnsU8,
  msgSendSize,
  msgSendU8,
} from './cocoa-msgsend-variants';
import { createMacOSDrain } from './cocoa-run-loop';
import { cocoa } from './cocoa-runtime';
import { createNavigationDelegate } from './cocoa-navigation-delegate';
import { createScriptMessageHandler } from './cocoa-script-message-handler';
import { computeWindowStyleMask, STANDARD_WINDOW_STYLE } from './cocoa-style-mask';
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
const WK_INJECTION_TIME_AT_DOCUMENT_START = 0n;
const SCRIPT_MESSAGE_HANDLER_NAME = 'sambar';

const dispatchScript = (envelopeJson: string): string =>
  `window.__sambar && window.__sambar._dispatch(${JSON.stringify(envelopeJson)});`;

class MacOSWebContents implements NativeWebContents {
  readonly #webview: Handle;
  #envelopeCallback: ((envelopeJson: string) => void) | undefined;
  #didFinishLoadCallback: (() => void) | undefined;

  constructor(webview: Handle) {
    this.#webview = webview;
  }

  /** @internal Called by the script message handler with renderer envelopes. */
  deliverRendererEnvelope(envelopeJson: string): void {
    this.#envelopeCallback?.(envelopeJson);
  }

  /** @internal Called by the navigation delegate when a load finishes. */
  deliverDidFinishLoad(): void {
    this.#didFinishLoadCallback?.();
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

  executeJavaScript(code: string): void {
    const rt = cocoa();
    // nil completion handler — fire-and-forget (D022).
    msgSendPtrPtr(
      this.#webview,
      rt.selectors.get('evaluateJavaScript:completionHandler:'),
      nsString(code),
      0n,
    );
  }

  sendEnvelopeToRenderer(envelopeJson: string): void {
    this.executeJavaScript(dispatchScript(envelopeJson));
  }

  onRendererEnvelope(callback: (envelopeJson: string) => void): void {
    this.#envelopeCallback = callback;
  }

  onDidFinishLoad(callback: () => void): void {
    this.#didFinishLoadCallback = callback;
  }
}

class MacOSWindow implements NativeWindow {
  readonly #window: Handle;
  readonly #contents: MacOSWebContents;
  #bounds: Rect;
  #closed = false;
  #onClosed: (() => void) | undefined;

  constructor(window: Handle, contents: MacOSWebContents, bounds: Rect) {
    this.#window = window;
    this.#contents = contents;
    this.#bounds = bounds;
  }

  get webContents(): NativeWebContents {
    return this.#contents;
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
  }

  hide(): void {
    msgSendPtr(this.#window, cocoa().selectors.get('orderOut:'), 0n);
  }

  isVisible(): boolean {
    return msgSendReturnsU8(this.#window, cocoa().selectors.get('isVisible')) === 1;
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    cocoa().msgSend(this.#window, cocoa().selectors.get('close'));
    this.#onClosed?.();
  }

  onClosed(callback: () => void): void {
    this.#onClosed = callback;
  }
}

class MacOSApplication implements NativeApplication {
  #started = false;
  #app: Handle = 0n;
  #pump: CooperativePump | undefined;
  #readyCallbacks: Array<() => void> = [];

  start(): void {
    if (this.#started) {
      return;
    }
    const rt = cocoa();
    loadWebKit();
    this.#app = rt.msgSend(rt.classes.get('NSApplication'), rt.selectors.get('sharedApplication'));
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

  createWindow(options: NativeWindowOptions): NativeWindow {
    const rt = cocoa();
    const frame: readonly [number, number, number, number] = [0, 0, options.width, options.height];

    const window = msgSendInitWithContentRect(
      rt.msgSend(rt.classes.get('NSWindow'), rt.selectors.get('alloc')),
      rt.selectors.get('initWithContentRect:styleMask:backing:defer:'),
      frame,
      BigInt(computeWindowStyleMask(STANDARD_WINDOW_STYLE)),
      NS_BACKING_STORE_BUFFERED,
      false,
    );

    const configuration = rt.msgSend(
      rt.msgSend(rt.classes.get('WKWebViewConfiguration'), rt.selectors.get('alloc')),
      rt.selectors.get('init'),
    );

    // The web view (and thus its contents) does not exist until after the
    // configuration is built, so the handler forwards to a late-bound contents
    // reference rather than capturing it directly.
    let contents: MacOSWebContents | undefined;
    const userContentController = rt.msgSend(
      configuration,
      rt.selectors.get('userContentController'),
    );
    const handler = createScriptMessageHandler((envelopeJson) =>
      contents?.deliverRendererEnvelope(envelopeJson),
    );
    msgSendPtrPtr(
      userContentController,
      rt.selectors.get('addScriptMessageHandler:name:'),
      handler.handle,
      nsString(SCRIPT_MESSAGE_HANDLER_NAME),
    );

    const userScript = msgSendPtrI64U8(
      rt.msgSend(rt.classes.get('WKUserScript'), rt.selectors.get('alloc')),
      rt.selectors.get('initWithSource:injectionTime:forMainFrameOnly:'),
      nsString(generatePreloadBootstrap()),
      WK_INJECTION_TIME_AT_DOCUMENT_START,
      0,
    );
    msgSendPtr(userContentController, rt.selectors.get('addUserScript:'), userScript);

    const webview = msgSendInitWithFrameConfig(
      rt.msgSend(rt.classes.get('WKWebView'), rt.selectors.get('alloc')),
      rt.selectors.get('initWithFrame:configuration:'),
      frame,
      configuration,
    );
    contents = new MacOSWebContents(webview);

    const navigationDelegate = createNavigationDelegate(() => contents?.deliverDidFinishLoad());
    msgSendPtr(webview, rt.selectors.get('setNavigationDelegate:'), navigationDelegate.handle);

    msgSendPtr(window, rt.selectors.get('setContentView:'), webview);
    msgSendPtr(window, rt.selectors.get('setTitle:'), nsString(options.title));

    const nativeWindow = new MacOSWindow(window, contents, {
      x: 0,
      y: 0,
      width: options.width,
      height: options.height,
    });
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

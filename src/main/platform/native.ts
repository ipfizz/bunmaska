// The backend seam (D024): plain TS values and callbacks; a native handle crosses only as an
// opaque bigint (popupMenu). This JSDoc is the contract every backend implements.

/** Screen or content coordinates. */
export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type BuiltProtocolResponse = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
};

/** The `protocol.handle` schemes at window creation, served through `dispatch`. */
export type NativeProtocol = {
  readonly schemes: readonly string[];
  /** `undefined` fails the request with a network error. */
  readonly dispatch: (url: string) => BuiltProtocolResponse | undefined;
};

export type NativeWindowOptions = {
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly show: boolean;
  /** Default `true`. */
  readonly resizable?: boolean;
  /** `false` is frameless; default `true`. */
  readonly frame?: boolean;
  /** Default `false`. */
  readonly fullscreen?: boolean;
  /**
   * User preload SOURCE (never a path, D024), injected at document-start after the bridge
   * bootstrap. Main frame only on every backend, as Electron's `nodeIntegrationInSubFrames: false`.
   */
  readonly preloadScript?: string;
  /** Read once: a scheme handled after the window exists is not served by it (Electron's rule too). */
  readonly protocol?: NativeProtocol;
};

/** Maps 1:1 to the Electron `webContents` event; only `did-fail-load` carries detail. */
export type NativeNavigationEvent =
  | { readonly type: 'did-start-loading' }
  | { readonly type: 'did-stop-loading' }
  | { readonly type: 'dom-ready' }
  | { readonly type: 'did-navigate' }
  | { readonly type: 'did-finish-load' }
  | {
      readonly type: 'did-fail-load';
      readonly errorCode: number;
      readonly errorDescription: string;
    };

export type MouseButton = 'left' | 'middle' | 'right';

/** Electron's `MouseInputEvent` subset; logical pixels from the web view's top-left. */
export type MouseInputEvent = {
  readonly type: 'mouseDown' | 'mouseUp' | 'mouseMove';
  readonly x: number;
  readonly y: number;
  /** Default `left`; ignored for `mouseMove`. */
  readonly button?: MouseButton;
};

/** Electron's `KeyboardInputEvent` subset; `keyCode` is an accelerator key (`'a'`, `'Enter'`). */
export type KeyboardInputEvent = {
  readonly type: 'keyDown' | 'keyUp' | 'char';
  readonly keyCode: string;
};

export type NativeInputEvent = MouseInputEvent | KeyboardInputEvent;

/**
 * The web view in a window. The api layer registers each `on*` callback once per view; a
 * backend that also listens internally must keep both (append, never replace), or its own
 * hook silently disappears (Linux derives `ready-to-show` from `onNavigation`).
 */
export interface NativeWebContents {
  /** Any URL WebKit loads, registered custom schemes included. */
  loadURL(url: string): void;
  /** @internal Test hook; no api-layer caller. */
  loadHTML(html: string, baseUrl?: string): void;
  /** `''` before the first navigation. */
  getURL(): string;
  /** `''` if the page has none. */
  getTitle(): string;
  reload(): void;
  reloadIgnoringCache(): void;
  stop(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  /**
   * Runs in the page world and resolves to the completion value. Only JSON-serializable
   * results survive (anything else rejects); a throw or a rejected Promise rejects.
   */
  executeJavaScript(code: string): Promise<unknown>;
  /** PDF bytes; rejects on Linux and Windows (no page-to-PDF API). */
  printToPDF(): Promise<Uint8Array>;
  /** PNG bytes; rejects on Windows (WinCairo has no UI-process snapshot). */
  capturePage(): Promise<Uint8Array>;
  /** Best-effort. */
  openDevTools(): void;
  /** Best-effort. */
  closeDevTools(): void;
  /** `1` is 100%. */
  setZoomFactor(factor: number): void;
  /** Applies to subsequent navigations. */
  setUserAgent(userAgent: string): void;
  /**
   * Delivered through the engine's input path, so the page sees `isTrusted === true`, which a
   * script-dispatched event cannot fake. Windows only; macOS and Linux throw.
   */
  sendInputEvent(event: NativeInputEvent): void;
  /** Delivers a raw JSON envelope to the renderer's bridge. */
  sendEnvelopeToRenderer(envelopeJson: string): void;
  onRendererEnvelope(callback: (envelopeJson: string) => void): void;
  onNavigation(callback: (event: NativeNavigationEvent) => void): void;
  /** Gets the URL of a `window.open`; the popup is always blocked. Windows never calls it. */
  setWindowOpenHandler(callback: (url: string) => void): void;
}

/**
 * Non-preventable `BrowserWindow` events of the same name. The vetoable `close` flows through
 * {@link NativeWindow.onClose} and the final `closed` through {@link NativeWindow.onClosed}.
 */
export type WindowEventType =
  | 'focus'
  | 'blur'
  | 'show'
  | 'hide'
  | 'resize'
  | 'move'
  | 'maximize'
  | 'unmaximize'
  | 'minimize'
  | 'restore'
  | 'ready-to-show';

export interface NativeWindow {
  readonly webContents: NativeWebContents;
  setTitle(title: string): void;
  getTitle(): string;
  setSize(width: number, height: number): void;
  getBounds(): Rect;
  /** Top-left corner; a no-op on Linux (GTK4 has no client-side positioning). */
  setPosition(x: number, y: number): void;
  /** Linux applies the size only. */
  setBounds(bounds: Rect): void;
  setResizable(resizable: boolean): void;
  /** `[0, 1]`; `1` is fully opaque. */
  setOpacity(opacity: number): void;
  /** Constrains the CONTENT size. */
  setMinimumSize(width: number, height: number): void;
  /** No-op on Linux. */
  center(): void;
  show(): void;
  hide(): void;
  isVisible(): boolean;
  focus(): void;
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  isMaximized(): boolean;
  isMinimized(): boolean;
  /** Un-minimizes. */
  restore(): void;
  isFocused(): boolean;
  setFullScreen(flag: boolean): void;
  isFullScreen(): boolean;
  /** No-op on Linux (GTK4 dropped keep-above). */
  setAlwaysOnTop(flag: boolean): void;
  /** A close REQUEST: consults {@link onClose}, so it can be vetoed. Idempotent. */
  close(): void;
  /** Closes without consulting {@link onClose}. */
  destroy(): void;
  /** Fires once, after teardown. */
  onClosed(callback: () => void): void;
  /** One registration per type; invoked each time the native event fires. */
  onWindowEvent(type: WindowEventType, callback: () => void): void;
  /**
   * Consulted before the title-bar button or `close()` closes the window: return `true` to
   * VETO (the window stays open), `false` to allow, after which teardown runs and `onClosed`
   * fires. Linux and Windows app quit also routes through it; macOS app quit does not.
   */
  onClose(callback: () => boolean): void;
  /**
   * Shows a realized native menu at content-relative (`x`, `y`). macOS and Windows BLOCK in a
   * nested menu-tracking loop until dismissed (D020-safe); Windows also destroys the handle.
   * Linux is non-blocking: activation arrives later via the cooperative pump.
   */
  popupMenu(menuHandle: bigint, x: number, y: number): void;
  /** Best-effort; idempotent. */
  closePopupMenu(): void;
}

/** AppKit-only application operations; other backends omit {@link NativeApplication.appKit}. */
export interface NativeAppKit {
  setActivationPolicy(policy: 'regular' | 'accessory' | 'prohibited'): void;
  hide(): void;
  show(): void;
  isHidden(): boolean;
  isActive(): boolean;
  /** `''` clears it. */
  setDockBadge(label: string): void;
  getDockBadge(): string;
  /** `critical` bounces until the app is focused. */
  bounceDock(critical: boolean): void;
}

export interface NativeApplication {
  /** Starts pumping the native run loop. Idempotent. */
  start(): void;
  onReady(callback: () => void): void;
  createWindow(options: NativeWindowOptions): NativeWindow;
  /** Stops the pump once `app.quit` closed the windows; a Promise defers the exit until it settles. */
  quit(): void | Promise<void>;
  /** Electron's `activate` (a Dock-icon click). macOS only; register before {@link start}. */
  onActivate?(callback: (hasVisibleWindows: boolean) => void): void;
  /** Electron's `open-url` (a deep link). macOS only; register before {@link start}. */
  onOpenUrl?(callback: (url: string) => void): void;
  /** Electron's `open-file` (a file association). macOS only; register before {@link start}. */
  onOpenFile?(callback: (path: string) => void): void;
  /** The OS asked the app to quit (macOS Cmd+Q, Dock Quit, logout); register before {@link start}. */
  onQuitRequest?(callback: () => void): void;
  readonly appKit?: NativeAppKit;
  /** macOS and Linux. */
  showAboutPanel?(): void;
}

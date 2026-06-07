/**
 * Backend-neutral contracts for the native platform layer.
 *
 * Everything above `platform/` (the public `api/` classes) depends only on
 * these interfaces, never on a concrete backend (`platform/macos`,
 * `platform/linux`). Platform-specific handles (`id`, `SEL`, `GtkWidget*`)
 * never appear here — the seam speaks only plain TS: numbers, strings, and
 * callbacks (D024).
 */

/** A rectangle in screen/content coordinates. */
export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Options for creating a native window + its embedded web view. */
export type NativeWindowOptions = {
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly show: boolean;
  /**
   * Resolved source of the user preload script, injected at document-start in
   * all frames AFTER the built-in bridge bootstrap. Undefined when no preload
   * was configured. The api layer resolves the path and reads the file; the
   * seam carries only the source string, never a path or handle (D024).
   */
  readonly preloadScript?: string;
};

/**
 * The web view embedded in a window. Sambar's `WebContents` delegates to this.
 *
 * The IPC surface (renderer messaging + navigation callbacks) is added to this
 * interface in the IPC phase, alongside its implementation — kept out until
 * then so the contract never advertises a method the backend does not provide.
 */
export interface NativeWebContents {
  /** Navigate to a URL (http/https/file/about). */
  loadURL(url: string): void;
  /** Load an inline HTML string with an optional base URL for relative refs. */
  loadHTML(html: string, baseUrl?: string): void;
  /** The web view's current URL, or `''` before the first navigation. */
  getURL(): string;
  /** Reload the current page. */
  reload(): void;
  /** Navigate back one entry in the session history, if possible. */
  goBack(): void;
  /** Navigate forward one entry in the session history, if possible. */
  goForward(): void;
  /** Whether there is a previous history entry to go back to. */
  canGoBack(): boolean;
  /** Whether there is a next history entry to go forward to. */
  canGoForward(): boolean;
  /**
   * Evaluate JS in the page world and resolve to the script's completion value
   * (Electron semantics). Only JSON-serializable results survive the boundary
   * (`JSON.stringify` semantics); a thrown error or rejected Promise rejects.
   */
  executeJavaScript(code: string): Promise<unknown>;
  /** Open the native web inspector (devtools) for this view. Best-effort. */
  openDevTools(): void;
  /** Deliver a raw IPC envelope (JSON) to the renderer's preload bridge. */
  sendEnvelopeToRenderer(envelopeJson: string): void;
  /** Register a callback for raw IPC envelopes (JSON) posted by the renderer. */
  onRendererEnvelope(callback: (envelopeJson: string) => void): void;
  /** Register a callback fired when a navigation finishes loading. */
  onDidFinishLoad(callback: () => void): void;
}

/**
 * Non-preventable window lifecycle events surfaced from the backend.
 *
 * Each maps to an Electron `BrowserWindow` event of the same name. The
 * preventable `close` is NOT in this set — it flows through {@link
 * NativeWindow.onClose} so a listener can veto it; the final `closed` flows
 * through {@link NativeWindow.onClosed}.
 */
export type WindowEventType =
  | 'focus'
  | 'blur'
  | 'show'
  | 'hide'
  | 'resize'
  | 'maximize'
  | 'unmaximize'
  | 'minimize'
  | 'restore'
  | 'ready-to-show';

/** A native top-level window. */
export interface NativeWindow {
  /** The window's web contents. */
  readonly webContents: NativeWebContents;
  setTitle(title: string): void;
  getTitle(): string;
  setSize(width: number, height: number): void;
  getBounds(): Rect;
  show(): void;
  hide(): void;
  isVisible(): boolean;
  /** Bring the window to the front and give it keyboard focus. */
  focus(): void;
  /** Minimize the window to the dock/taskbar. */
  minimize(): void;
  /** Maximize (zoom) the window to fill the available screen area. */
  maximize(): void;
  /** Restore a maximized window to its previous size. */
  unmaximize(): void;
  isMaximized(): boolean;
  isMinimized(): boolean;
  /** Close and destroy the window. Idempotent. */
  close(): void;
  /** Register a callback fired once when the window is closed. */
  onClosed(callback: () => void): void;
  /**
   * Register a callback for a non-preventable window lifecycle event. The same
   * type may be registered once; the backend invokes it each time the native
   * event fires.
   */
  onWindowEvent(type: WindowEventType, callback: () => void): void;
  /**
   * Register the preventable-close callback, consulted BEFORE the window closes
   * on EVERY close path (title-bar button, programmatic `close()`, app quit).
   * Return `true` to VETO the close (the window stays open); return `false` to
   * allow it, after which the backend runs teardown and fires `onClosed`.
   */
  onClose(callback: () => boolean): void;
}

/** The native application host: lifecycle + window factory. */
export interface NativeApplication {
  /** Bootstrap the native app and begin pumping its run loop. Idempotent. */
  start(): void;
  /** Register a callback fired once the app is ready to create windows. */
  onReady(callback: () => void): void;
  /** Create a native window. */
  createWindow(options: NativeWindowOptions): NativeWindow;
  /** Stop the run loop and release the application. */
  quit(): void;
  /**
   * Register a callback fired when the app is re-activated (Electron's `activate`
   * — e.g. a macOS Dock-icon click), receiving whether any windows are visible.
   * Optional: platforms without an activation concept (Linux) omit it. Must be
   * registered before {@link start}.
   */
  onActivate?(callback: (hasVisibleWindows: boolean) => void): void;
  /**
   * Register a callback for an OS request to open a URL (custom-scheme deep link;
   * Electron's `open-url`). macOS-only; other backends omit it. Register before
   * {@link start}.
   */
  onOpenUrl?(callback: (url: string) => void): void;
  /**
   * Register a callback for an OS request to open a file path (file association;
   * Electron's `open-file`). macOS-only; other backends omit it. Register before
   * {@link start}.
   */
  onOpenFile?(callback: (path: string) => void): void;
}

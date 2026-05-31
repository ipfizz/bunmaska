import type { Pointer } from 'bun:ffi';
import { generatePreloadBootstrap } from '../../../renderer/preload-bootstrap';
import { CooperativePump } from '../../run-loop';
import { cstr } from '../cstr';
import type {
  NativeApplication,
  NativeWebContents,
  NativeWindow,
  NativeWindowOptions,
  Rect,
} from '../native';
import { loadGtkFFI } from './gtk-ffi';
import { createLinuxDrain } from './gtk-run-loop';
import { makeCloseRequestCallback, makeLoadChangedCallback, SignalRegistry } from './gtk-signals';
import { createWebViewWithIpc, sendToRenderer } from './webkit-ipc';
import { loadWebKitGtkFFI, readGetUriResult } from './webkitgtk-ffi';

/**
 * Linux {@link NativeApplication} backend on GTK 4 + WebKitGTK 6.0, pure
 * `bun:ffi`. Mirrors `cocoa-backend.ts` structurally (D024): a thin lifecycle
 * shell over a cooperative GLib pump plus a window factory.
 *
 * The pump reuses the shared {@link CooperativePump} driven by the Linux drain
 * (`g_main_context_iteration` with `may_block = FALSE`) — NO `GtkApplication`
 * or `g_main_loop_run`, which would block Bun's thread (D020).
 */

const GTK_TRUE = 1;
const GTK_FALSE = 0;

/**
 * Linux {@link NativeWebContents}: a `WebKitWebView` wired for navigation, JS
 * evaluation, and the IPC round-trip.
 */
class LinuxWebContents implements NativeWebContents {
  readonly #view: Pointer;
  readonly #registry: SignalRegistry;
  #didFinishLoad = false;
  readonly #pendingEnvelopes: string[] = [];
  readonly #didFinishLoadCallbacks: Array<() => void> = [];
  readonly #rendererEnvelopeCallbacks: Array<(json: string) => void> = [];

  constructor() {
    const wired = createWebViewWithIpc({
      preloadSource: generatePreloadBootstrap(),
      onMessage: (json: string) => {
        for (const callback of this.#rendererEnvelopeCallbacks) {
          callback(json);
        }
      },
    });
    this.#view = wired.view;
    this.#registry = wired.registry;
    this.#registry.connect(
      this.#view,
      'load-changed',
      makeLoadChangedCallback(() => {
        this.#didFinishLoad = true;
        for (const callback of this.#didFinishLoadCallbacks) {
          callback();
        }
        const queued = [...this.#pendingEnvelopes];
        this.#pendingEnvelopes.length = 0;
        for (const json of queued) {
          sendToRenderer(this.#view, json);
        }
      }),
    );
  }

  /** The underlying `WebKitWebView*` to embed as the window's child. */
  view(): Pointer {
    return this.#view;
  }

  /** The signal registry to disconnect when the owning window closes. */
  registry(): SignalRegistry {
    return this.#registry;
  }

  loadURL(url: string): void {
    const webkit = loadWebKitGtkFFI();
    webkit.symbols.webkit_web_view_load_uri(this.#view, cstr(url));
  }

  loadHTML(html: string, baseUrl?: string): void {
    const webkit = loadWebKitGtkFFI();
    // base_uri is nullable; cstring cannot encode NULL, so pass a pinned
    // NUL-terminated buffer for a real base or null for NULL.
    const baseUri = baseUrl === undefined ? null : cstr(baseUrl);
    webkit.symbols.webkit_web_view_load_html(this.#view, cstr(html), baseUri);
  }

  getURL(): string {
    const webkit = loadWebKitGtkFFI();
    return readGetUriResult(webkit.symbols.webkit_web_view_get_uri(this.#view));
  }

  reload(): void {
    const webkit = loadWebKitGtkFFI();
    webkit.symbols.webkit_web_view_reload(this.#view);
  }

  goBack(): void {
    const webkit = loadWebKitGtkFFI();
    webkit.symbols.webkit_web_view_go_back(this.#view);
  }

  goForward(): void {
    const webkit = loadWebKitGtkFFI();
    webkit.symbols.webkit_web_view_go_forward(this.#view);
  }

  canGoBack(): boolean {
    const webkit = loadWebKitGtkFFI();
    return webkit.symbols.webkit_web_view_can_go_back(this.#view) !== 0;
  }

  canGoForward(): boolean {
    const webkit = loadWebKitGtkFFI();
    return webkit.symbols.webkit_web_view_can_go_forward(this.#view) !== 0;
  }

  executeJavaScript(code: string): void {
    const webkit = loadWebKitGtkFFI();
    webkit.symbols.webkit_web_view_evaluate_javascript(
      this.#view,
      cstr(code),
      -1n,
      null,
      null,
      null,
      null,
      null,
    );
  }

  sendEnvelopeToRenderer(envelopeJson: string): void {
    if (!this.#didFinishLoad) {
      this.#pendingEnvelopes.push(envelopeJson);
      return;
    }
    sendToRenderer(this.#view, envelopeJson);
  }

  onRendererEnvelope(callback: (envelopeJson: string) => void): void {
    this.#rendererEnvelopeCallbacks.push(callback);
  }

  onDidFinishLoad(callback: () => void): void {
    if (this.#didFinishLoad) {
      callback();
      return;
    }
    this.#didFinishLoadCallbacks.push(callback);
  }
}

/**
 * Linux {@link NativeWindow}: a `GtkWindow` hosting a `WebKitWebView` as its
 * single child. Title / visibility / minimized state are tracked in JS because
 * GTK 4 exposes no reliable getters for them.
 */
class LinuxWindow implements NativeWindow {
  readonly #window: Pointer;
  readonly #webContents: LinuxWebContents;
  readonly #registry = new SignalRegistry();
  #title: string;
  #visible = false;
  #minimized = false;
  readonly #defaultWidth: number;
  readonly #defaultHeight: number;
  #closed = false;
  readonly #closedCallbacks: Array<() => void> = [];

  constructor(options: NativeWindowOptions) {
    const gtk = loadGtkFFI();
    this.#title = options.title;
    this.#defaultWidth = options.width;
    this.#defaultHeight = options.height;
    const window = gtk.symbols.gtk_window_new();
    if (window === null) {
      throw new Error('gtk_window_new() returned NULL');
    }
    this.#window = window;
    gtk.symbols.gtk_window_set_title(this.#window, cstr(options.title));
    gtk.symbols.gtk_window_set_default_size(this.#window, options.width, options.height);

    this.#webContents = new LinuxWebContents();
    gtk.symbols.gtk_window_set_child(this.#window, this.#webContents.view());

    this.#registry.connect(
      this.#window,
      'close-request',
      makeCloseRequestCallback(() => {
        this.#handleClosed();
      }),
    );

    if (options.show) {
      this.show();
    }
  }

  get webContents(): NativeWebContents {
    return this.#webContents;
  }

  #handleClosed(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#visible = false;
    for (const callback of this.#closedCallbacks) {
      callback();
    }
    this.#webContents.registry().disconnectAll();
    this.#registry.disconnectAll();
  }

  setTitle(title: string): void {
    const gtk = loadGtkFFI();
    this.#title = title;
    gtk.symbols.gtk_window_set_title(this.#window, cstr(title));
  }

  getTitle(): string {
    return this.#title;
  }

  setSize(width: number, height: number): void {
    const gtk = loadGtkFFI();
    gtk.symbols.gtk_window_set_default_size(this.#window, width, height);
  }

  getBounds(): Rect {
    const gtk = loadGtkFFI();
    const width = gtk.symbols.gtk_widget_get_width(this.#window);
    const height = gtk.symbols.gtk_widget_get_height(this.#window);
    return {
      x: 0,
      y: 0,
      width: width > 0 ? width : this.#defaultWidth,
      height: height > 0 ? height : this.#defaultHeight,
    };
  }

  show(): void {
    const gtk = loadGtkFFI();
    gtk.symbols.gtk_widget_set_visible(this.#window, GTK_TRUE);
    gtk.symbols.gtk_window_present(this.#window);
    this.#visible = true;
    this.#minimized = false;
  }

  hide(): void {
    const gtk = loadGtkFFI();
    gtk.symbols.gtk_widget_set_visible(this.#window, GTK_FALSE);
    this.#visible = false;
  }

  isVisible(): boolean {
    return this.#visible;
  }

  focus(): void {
    const gtk = loadGtkFFI();
    gtk.symbols.gtk_window_present(this.#window);
  }

  minimize(): void {
    const gtk = loadGtkFFI();
    gtk.symbols.gtk_window_minimize(this.#window);
    this.#minimized = true;
  }

  maximize(): void {
    const gtk = loadGtkFFI();
    gtk.symbols.gtk_window_maximize(this.#window);
  }

  unmaximize(): void {
    const gtk = loadGtkFFI();
    gtk.symbols.gtk_window_unmaximize(this.#window);
  }

  isMaximized(): boolean {
    const gtk = loadGtkFFI();
    return gtk.symbols.gtk_window_is_maximized(this.#window) !== 0;
  }

  isMinimized(): boolean {
    return this.#minimized;
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    const gtk = loadGtkFFI();
    // Disconnect handlers and tear down web contents while the GObjects are
    // still alive, then destroy the window.
    this.#handleClosed();
    gtk.symbols.gtk_window_destroy(this.#window);
  }

  onClosed(callback: () => void): void {
    this.#closedCallbacks.push(callback);
  }
}

/**
 * Linux {@link NativeApplication}: initializes GTK, drives the cooperative pump,
 * and owns the set of live windows.
 */
export class LinuxApplication implements NativeApplication {
  #pump: CooperativePump | undefined;
  #started = false;
  #ready = false;
  readonly #readyCallbacks: Array<() => void> = [];
  readonly #windows = new Set<NativeWindow>();

  start(): void {
    if (this.#started) {
      return;
    }
    const gtk = loadGtkFFI();
    if (gtk.symbols.gtk_init_check() === 0) {
      throw new Error('gtk_init_check() failed: no display available for the Linux backend');
    }
    this.#started = true;
    this.#ready = true;
    for (const callback of this.#readyCallbacks) {
      callback();
    }
    this.#readyCallbacks.length = 0;
    this.#pump = new CooperativePump(createLinuxDrain());
    this.#pump.start();
  }

  onReady(callback: () => void): void {
    if (this.#ready) {
      callback();
      return;
    }
    this.#readyCallbacks.push(callback);
  }

  createWindow(options: NativeWindowOptions): NativeWindow {
    const window = new LinuxWindow(options);
    this.#windows.add(window);
    window.onClosed(() => {
      this.#windows.delete(window);
    });
    return window;
  }

  quit(): void {
    if (!this.#started) {
      return;
    }
    for (const window of [...this.#windows]) {
      window.close();
    }
    this.#windows.clear();
    this.#pump?.stop();
    this.#pump = undefined;
    this.#started = false;
  }
}

/** Construct the Linux {@link NativeApplication}. */
export const createLinuxApplication = (): NativeApplication => new LinuxApplication();

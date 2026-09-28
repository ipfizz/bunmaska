import { type Pointer, ptr } from 'bun:ffi';
import { isDevRestart } from '../../dev-reload';
import { UnsupportedPlatformError } from '../../../common/errors';
import { createLogger } from '../../../common/logger';
import {
  generateChannelId,
  generateIsolatedChannelSetup,
  generateIsolatedHostSource,
  generatePageWorldStub,
} from '../../../renderer/api/cross-world-bridge';
import { generatePreloadBootstrap } from '../../../renderer/preload-bootstrap';
import { CooperativePump } from '../../run-loop';
import { cstr } from '../cstr';
import type { NativeMenuItemSpec } from '../macos/cocoa-menu';
import type {
  NativeApplication,
  NativeNavigationEvent,
  NativeWebContents,
  NativeWindow,
  NativeWindowOptions,
  Rect,
  WindowEventType,
} from '../native';
import { windowControlsScript } from '../window-controls';
import { ExecResultChannel } from './eval-js';
import { loadGObjectFFI } from './gobject-ffi';
import { loadGtkFFI } from './gtk-ffi';
import { getCurrentAppMenu, getMenuEntry, realizeForWindow, onAppMenuCleared } from './gtk-menu';
import { loadGtkMenuFFI } from './gtk-menu-ffi';
import { createLinuxDrain } from './gtk-run-loop';
import {
  makeCloseRequestCallback,
  makeCreateCallback,
  makeLoadCallbacks,
  makeNotifyCallback,
  SignalRegistry,
} from './gtk-signals';
import { createWebViewWithIpc, evalInPageWorld, sendToRenderer } from './webkit-ipc';
import { capturePage as webkitCapturePage } from './webkit-snapshot';
import { registerAllSchemes } from './webkit-uri-scheme';
import { loadWebKitGtkFFI, readGetUriResult } from './webkitgtk-ffi';

// Never GtkApplication or g_main_loop_run: both block Bun's only thread (D020).

const log = createLogger('linux-backend');

const GTK_TRUE = 1;
const GTK_FALSE = 0;
/** `GtkOrientation`: stack the menu bar above the webview vertically. */
const GTK_ORIENTATION_VERTICAL = 1;

class LinuxWebContents implements NativeWebContents {
  readonly #view: Pointer;
  readonly #ucm: Pointer;
  readonly #registry: SignalRegistry;
  readonly #exec = new ExecResultChannel((source) => evalInPageWorld(this.#view, source));
  #destroyed = false;
  #bridgeReady = false;
  readonly #pendingEnvelopes: string[] = [];
  readonly #navigationCallbacks: Array<(event: NativeNavigationEvent) => void> = [];
  readonly #rendererEnvelopeCallbacks: Array<(json: string) => void> = [];
  #windowOpenCallback: ((url: string) => void) | undefined;

  constructor(userPreloadSource?: string) {
    const channelId = generateChannelId();
    const wired = createWebViewWithIpc({
      preloadSource: generatePreloadBootstrap(),
      isolatedSetupSource: generateIsolatedChannelSetup(channelId),
      isolatedHostSource: generateIsolatedHostSource(channelId),
      // No `__bunmaska` in the page world (context isolation): it only mirrors `--app-region`.
      pageWorldSource: `${generatePageWorldStub(channelId)}\n${windowControlsScript()}`, // ponytail: frameless window-op buttons wait on the isolated-world bridge (D045)
      ...(userPreloadSource !== undefined ? { userPreloadSource } : {}),
      onMessage: (json: string) => {
        this.#markBridgeReady();
        for (const callback of this.#rendererEnvelopeCallbacks) {
          callback(json);
        }
      },
      onExecMessage: (json: string) => {
        this.#exec.deliverExecResult(json);
      },
      onDomReady: () => {
        this.#markBridgeReady();
        this.#dispatchNavigation({ type: 'dom-ready' });
      },
    });
    this.#view = wired.view;
    this.#ucm = wired.ucm;
    this.#registry = wired.registry;
    registerAllSchemes(this.#view);
    const webkit = loadWebKitGtkFFI();
    webkit.symbols.webkit_settings_set_enable_developer_extras(
      webkit.symbols.webkit_web_view_get_settings(this.#view),
      GTK_TRUE,
    );
    const load = makeLoadCallbacks((event) => {
      if (event.type === 'did-finish-load') {
        this.#markBridgeReady();
      }
      this.#dispatchNavigation(event);
    });
    this.#registry.connect(this.#view, 'load-changed', load.changed);
    this.#registry.connect(this.#view, 'load-failed', load.failed);
    this.#registry.connect(
      this.#view,
      'create',
      makeCreateCallback((url) => this.#windowOpenCallback?.(url)),
    );
  }

  /** Flush queued envelopes once the first page's isolated-world bridge is running. */
  #markBridgeReady(): void {
    if (this.#bridgeReady) {
      return;
    }
    this.#bridgeReady = true;
    for (const json of this.#pendingEnvelopes.splice(0)) {
      this.sendEnvelopeToRenderer(json);
    }
  }

  #dispatchNavigation(event: NativeNavigationEvent): void {
    for (const callback of this.#navigationCallbacks) {
      callback(event);
    }
  }

  /** The underlying `WebKitWebView*` to embed as the window's child. */
  view(): Pointer {
    return this.#view;
  }

  /** WebKit symbols while the view lives; `undefined` once the window closed and freed it. */
  #live(): ReturnType<typeof loadWebKitGtkFFI>['symbols'] | undefined {
    return this.#destroyed ? undefined : loadWebKitGtkFFI().symbols;
  }

  /** @internal Tear down on window close; every later call is a no-op on the freed view. */
  teardown(): void {
    this.#destroyed = true;
    this.#exec.destroy();
    this.#registry.disconnectAll();
    // Unref on a later tick: close() may run inside this manager's own script-message emission.
    const ucm = this.#ucm;
    setTimeout(() => loadGObjectFFI().symbols.g_object_unref(ucm), 0);
  }

  loadURL(url: string): void {
    this.#live()?.webkit_web_view_load_uri(this.#view, cstr(url));
  }

  loadHTML(html: string, baseUrl?: string): void {
    // base_uri is nullable and FFI cstring cannot encode NULL.
    const baseUri = baseUrl === undefined ? null : cstr(baseUrl);
    this.#live()?.webkit_web_view_load_html(this.#view, cstr(html), baseUri);
  }

  getURL(): string {
    const webkit = this.#live();
    return webkit === undefined ? '' : readGetUriResult(webkit.webkit_web_view_get_uri(this.#view));
  }

  getTitle(): string {
    const webkit = this.#live();
    return webkit === undefined
      ? ''
      : readGetUriResult(webkit.webkit_web_view_get_title(this.#view));
  }

  reload(): void {
    this.#live()?.webkit_web_view_reload(this.#view);
  }

  reloadIgnoringCache(): void {
    this.#live()?.webkit_web_view_reload_bypass_cache(this.#view);
  }

  stop(): void {
    this.#live()?.webkit_web_view_stop_loading(this.#view);
  }

  goBack(): void {
    this.#live()?.webkit_web_view_go_back(this.#view);
  }

  goForward(): void {
    this.#live()?.webkit_web_view_go_forward(this.#view);
  }

  canGoBack(): boolean {
    return (this.#live()?.webkit_web_view_can_go_back(this.#view) ?? 0) !== 0;
  }

  canGoForward(): boolean {
    return (this.#live()?.webkit_web_view_can_go_forward(this.#view) ?? 0) !== 0;
  }

  setZoomFactor(factor: number): void {
    this.#live()?.webkit_web_view_set_zoom_level(this.#view, factor);
  }

  setUserAgent(userAgent: string): void {
    const webkit = this.#live();
    // Takes effect on the next navigation.
    webkit?.webkit_settings_set_user_agent(
      webkit.webkit_web_view_get_settings(this.#view),
      cstr(userAgent),
    );
  }

  executeJavaScript(code: string): Promise<unknown> {
    return this.#exec.executeJavaScript(code);
  }

  printToPDF(): Promise<Uint8Array> {
    // WebKitGTK prints only to a printer or file; it has no page-to-PDF-bytes API.
    return Promise.reject(
      new UnsupportedPlatformError('webContents.printToPDF is not yet supported on Linux'),
    );
  }

  capturePage(): Promise<Uint8Array> {
    if (this.#destroyed) {
      return Promise.reject(new Error('capturePage failed: web contents destroyed'));
    }
    return webkitCapturePage(this.#view);
  }

  sendInputEvent(): void {
    throw new UnsupportedPlatformError('webContents.sendInputEvent is not yet supported on Linux');
  }

  openDevTools(): void {
    const webkit = this.#live();
    const inspector = webkit?.webkit_web_view_get_inspector(this.#view) ?? null;
    if (inspector !== null) {
      webkit?.webkit_web_inspector_show(inspector);
    }
  }

  closeDevTools(): void {
    const webkit = this.#live();
    const inspector = webkit?.webkit_web_view_get_inspector(this.#view) ?? null;
    if (inspector !== null) {
      webkit?.webkit_web_inspector_close(inspector);
    }
  }

  sendEnvelopeToRenderer(envelopeJson: string): void {
    if (this.#destroyed) {
      return; // an invoke reply or send() after close: the view is freed.
    }
    if (!this.#bridgeReady) {
      this.#pendingEnvelopes.push(envelopeJson);
      return;
    }
    sendToRenderer(this.#view, envelopeJson);
  }

  onRendererEnvelope(callback: (envelopeJson: string) => void): void {
    this.#rendererEnvelopeCallbacks.push(callback);
  }

  onNavigation(callback: (event: NativeNavigationEvent) => void): void {
    this.#navigationCallbacks.push(callback);
  }

  setWindowOpenHandler(callback: (url: string) => void): void {
    this.#windowOpenCallback = callback;
  }
}

/** Title, visibility and minimized state are tracked in JS: GTK 4 has no reliable getters for them. */
class LinuxWindow implements NativeWindow {
  readonly #window: Pointer;
  readonly #webContents: LinuxWebContents;
  readonly #registry = new SignalRegistry();
  #title: string;
  #visible = false;
  #minimized = false;
  #active = false;
  #maximized = false;
  #defaultWidth: number;
  #defaultHeight: number;
  #closed = false;
  #activePopover: Pointer | null = null;
  readonly #closedCallbacks: Array<() => void> = [];
  #onClose: (() => boolean) | undefined;
  #releaseAppMenu: (() => void) | undefined;
  readonly #eventHandlers = new Map<WindowEventType, () => void>();

  #emitEvent(type: WindowEventType): void {
    this.#eventHandlers.get(type)?.();
  }

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
    if (options.frame === false) {
      gtk.symbols.gtk_window_set_decorated(this.#window, GTK_FALSE);
    }
    if (options.resizable === false) {
      gtk.symbols.gtk_window_set_resizable(this.#window, GTK_FALSE);
    }
    if (options.fullscreen === true) {
      gtk.symbols.gtk_window_fullscreen(this.#window);
    }

    this.#webContents = new LinuxWebContents(options.preloadScript);
    const appMenu = getCurrentAppMenu();
    if (appMenu === undefined) {
      gtk.symbols.gtk_window_set_child(this.#window, this.#webContents.view());
    } else {
      // Per-window model + group, so role items act on THIS window's own view (D039).
      const menu = loadGtkMenuFFI();
      const view = this.#webContents.view();
      const win = this.#window;
      const dispatchRole = (spec: NativeMenuItemSpec): void => {
        if (this.#closed) {
          return; // the view and window may be freed (use-after-free guard, D039).
        }
        if (spec.editingCommand !== undefined) {
          loadWebKitGtkFFI().symbols.webkit_web_view_execute_editing_command(
            view,
            cstr(spec.editingCommand),
          );
          return;
        }
        if (spec.windowAction === 'minimize') {
          gtk.symbols.gtk_window_minimize(win);
        } else if (spec.windowAction === 'close') {
          this.close();
        } else if (spec.windowAction === 'zoom') {
          if (gtk.symbols.gtk_window_is_maximized(win) !== 0) {
            gtk.symbols.gtk_window_unmaximize(win);
          } else {
            gtk.symbols.gtk_window_maximize(win);
          }
        } else if (spec.windowAction === 'togglefullscreen') {
          if (gtk.symbols.gtk_window_is_fullscreen(win) !== 0) {
            gtk.symbols.gtk_window_unfullscreen(win);
          } else {
            gtk.symbols.gtk_window_fullscreen(win);
          }
        }
      }; // ponytail: appAction roles (quit/about) are inert on a Linux click; their shortcuts work (D039)
      const entry = realizeForWindow(appMenu.specs, dispatchRole);
      const model = Number(entry.model) as unknown as Pointer;
      const group = Number(entry.group) as unknown as Pointer;
      const box = menu.symbols.gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
      const bar = menu.symbols.gtk_popover_menu_bar_new_from_model(model);
      menu.symbols.gtk_box_append(box, bar);
      menu.symbols.gtk_box_append(box, view);
      this.#releaseAppMenu = onAppMenuCleared(() => {
        if (!this.#closed) {
          menu.symbols.gtk_box_remove(box, bar);
        }
      });
      menu.symbols.gtk_widget_insert_action_group(this.#window, cstr('bunmaska'), group);
      gtk.symbols.gtk_window_set_child(this.#window, box);
    }

    this.#registry.connect(
      this.#window,
      'close-request',
      makeCloseRequestCallback(() => this.#requestClose()),
    );

    this.#registry.connect(
      this.#window,
      'notify::is-active',
      makeNotifyCallback(() => {
        const active = gtk.symbols.gtk_window_is_active(this.#window) !== 0;
        if (active === this.#active) {
          return;
        }
        this.#active = active;
        this.#emitEvent(active ? 'focus' : 'blur');
      }),
    );

    // GTK 4 leaves default-width/height untouched while maximized or fullscreen.
    this.#registry.connect(
      this.#window,
      'notify::maximized',
      makeNotifyCallback(() => {
        const maximized = gtk.symbols.gtk_window_is_maximized(this.#window) !== 0;
        if (maximized === this.#maximized) {
          return;
        }
        this.#maximized = maximized;
        this.#emitEvent('resize');
        this.#emitEvent(maximized ? 'maximize' : 'unmaximize');
      }),
    );
    this.#registry.connect(
      this.#window,
      'notify::fullscreened',
      makeNotifyCallback(() => this.#emitEvent('resize')),
    );

    // One thunk per signal, so the registry closes each exactly once.
    this.#registry.connect(
      this.#window,
      'notify::default-width',
      makeNotifyCallback(() => this.#emitEvent('resize')),
    );
    this.#registry.connect(
      this.#window,
      'notify::default-height',
      makeNotifyCallback(() => this.#emitEvent('resize')),
    );

    let readyToShowEmitted = false;
    this.#webContents.onNavigation((event) => {
      if (event.type === 'did-finish-load' && !readyToShowEmitted) {
        readyToShowEmitted = true;
        this.#emitEvent('ready-to-show');
      }
    });

    if (options.show) {
      this.show();
    }
  }

  get webContents(): NativeWebContents {
    return this.#webContents;
  }

  /** Native close: true vetoes; otherwise tear down and let GTK destroy the window. */
  #requestClose(): boolean {
    if (this.#closed) {
      return false;
    }
    if (this.#vetoed()) {
      return true;
    }
    this.#handleClosed();
    return false;
  }

  /** A throwing `close` listener does not veto: the window still closes, as in Electron. */
  #vetoed(): boolean {
    try {
      return this.#onClose?.() === true;
    } catch (error) {
      log.error("a 'close' listener threw; closing anyway", error);
      return false;
    }
  }

  #handleClosed(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#visible = false;
    this.#closeActivePopover(); // drop any open context-menu popover before teardown.
    for (const callback of this.#closedCallbacks) {
      try {
        callback();
      } catch (error) {
        log.error("a 'closed' listener threw", error);
      }
    }
    this.#releaseAppMenu?.();
    this.#webContents.teardown();
    this.#registry.disconnectAll();
  }

  /** GTK symbols while the window lives; `undefined` once it is destroyed (freed). */
  #gtk(): ReturnType<typeof loadGtkFFI>['symbols'] | undefined {
    return this.#closed ? undefined : loadGtkFFI().symbols;
  }

  setTitle(title: string): void {
    this.#title = title;
    this.#gtk()?.gtk_window_set_title(this.#window, cstr(title));
  }

  getTitle(): string {
    return this.#title;
  }

  setSize(width: number, height: number): void {
    this.#defaultWidth = width;
    this.#defaultHeight = height;
    this.#gtk()?.gtk_window_set_default_size(this.#window, width, height);
  }

  setPosition(_x: number, _y: number): void {
    // No-op: GTK 4 has no client positioning; the compositor places windows (Wayland forbids it).
  }

  setBounds(bounds: Rect): void {
    this.setSize(bounds.width, bounds.height);
  }

  setResizable(resizable: boolean): void {
    this.#gtk()?.gtk_window_set_resizable(this.#window, resizable ? GTK_TRUE : GTK_FALSE);
  }

  setOpacity(opacity: number): void {
    this.#gtk()?.gtk_widget_set_opacity(this.#window, opacity);
  }

  setMinimumSize(width: number, height: number): void {
    this.#gtk()?.gtk_widget_set_size_request(this.#window, width, height);
  }

  center(): void {
    // No-op: see setPosition.
  }

  getBounds(): Rect {
    const gtk = this.#gtk();
    const width = gtk?.gtk_widget_get_width(this.#window) ?? 0;
    const height = gtk?.gtk_widget_get_height(this.#window) ?? 0;
    return {
      x: 0,
      y: 0,
      width: width > 0 ? width : this.#defaultWidth,
      height: height > 0 ? height : this.#defaultHeight,
    };
  }

  show(): void {
    const gtk = this.#gtk();
    if (gtk === undefined) {
      return;
    }
    gtk.gtk_widget_set_visible(this.#window, GTK_TRUE);
    // `present` requests focus; a dev respawn leaves the editor focused.
    if (!isDevRestart()) {
      gtk.gtk_window_present(this.#window);
    }
    this.#visible = true;
    this.#minimized = false;
    this.#emitEvent('show');
  }

  hide(): void {
    const gtk = this.#gtk();
    if (gtk === undefined) {
      return;
    }
    gtk.gtk_widget_set_visible(this.#window, GTK_FALSE);
    this.#visible = false;
    this.#emitEvent('hide');
  }

  isVisible(): boolean {
    return this.#visible;
  }

  focus(): void {
    this.#gtk()?.gtk_window_present(this.#window);
  }

  minimize(): void {
    this.#gtk()?.gtk_window_minimize(this.#window);
    this.#minimized = true;
  }

  maximize(): void {
    this.#gtk()?.gtk_window_maximize(this.#window);
  }

  unmaximize(): void {
    this.#gtk()?.gtk_window_unmaximize(this.#window);
  }

  isMaximized(): boolean {
    return (this.#gtk()?.gtk_window_is_maximized(this.#window) ?? 0) !== 0;
  }

  isMinimized(): boolean {
    return this.#minimized; // ponytail: misses WM iconify and never emits minimize/restore; X11 reports it via GdkToplevel notify::state
  }

  restore(): void {
    this.#gtk()?.gtk_window_unminimize(this.#window);
    this.#minimized = false;
  }

  isFocused(): boolean {
    return (this.#gtk()?.gtk_window_is_active(this.#window) ?? 0) !== 0;
  }

  setFullScreen(flag: boolean): void {
    const gtk = this.#gtk();
    if (flag) {
      gtk?.gtk_window_fullscreen(this.#window);
    } else {
      gtk?.gtk_window_unfullscreen(this.#window);
    }
  }

  isFullScreen(): boolean {
    return (this.#gtk()?.gtk_window_is_fullscreen(this.#window) ?? 0) !== 0;
  }

  setAlwaysOnTop(_flag: boolean): void {
    // No-op: GTK 4 dropped keep-above and has no portable replacement.
  }

  close(): void {
    if (this.#closed || this.#vetoed()) {
      return;
    }
    this.destroy(); // no-op when a `close` listener already destroyed the window
  }

  destroy(): void {
    if (this.#closed) {
      return;
    }
    this.#handleClosed();
    loadGtkFFI().symbols.gtk_window_destroy(this.#window);
  }

  onClosed(callback: () => void): void {
    this.#closedCallbacks.push(callback);
  }

  onClose(callback: () => boolean): void {
    this.#onClose = callback;
  }

  onWindowEvent(type: WindowEventType, callback: () => void): void {
    this.#eventHandlers.set(type, callback);
  }

  popupMenu(menuHandle: bigint, x: number, y: number): void {
    if (this.#closed) {
      return;
    }
    const entry = getMenuEntry(menuHandle);
    if (entry === undefined) {
      return; // unknown handle
    }
    const menu = loadGtkMenuFFI();
    this.#closeActivePopover(); // replace any open popover.
    const popover = menu.symbols.gtk_popover_menu_new_from_model(
      Number(entry.model) as unknown as Pointer,
    );
    if (popover === null) {
      return;
    }
    menu.symbols.gtk_widget_set_parent(popover, this.#window);
    // Without its action group the items render but stay inert.
    menu.symbols.gtk_widget_insert_action_group(
      popover,
      cstr('bunmaska'),
      Number(entry.group) as unknown as Pointer,
    );
    // A 1x1 GdkRectangle { x, y, width, height } is a point, window-relative.
    menu.symbols.gtk_popover_set_pointing_to(popover, ptr(new Int32Array([x, y, 1, 1])));
    menu.symbols.gtk_popover_popup(popover); // non-blocking; item activation fires via the pump.
    this.#activePopover = popover;
  }

  closePopupMenu(): void {
    this.#closeActivePopover();
  }

  #closeActivePopover(): void {
    if (this.#activePopover === null) {
      return;
    }
    const menu = loadGtkMenuFFI();
    menu.symbols.gtk_popover_popdown(this.#activePopover);
    menu.symbols.gtk_widget_unparent(this.#activePopover);
    this.#activePopover = null;
  }
}

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
    // Pump first: a throwing 'ready' listener must not leave GTK unpumped.
    this.#pump = new CooperativePump(createLinuxDrain());
    this.#pump.start();
    for (const callback of this.#readyCallbacks.splice(0)) {
      callback();
    }
  }

  onReady(callback: () => void): void {
    if (this.#ready) {
      callback();
      return;
    }
    this.#readyCallbacks.push(callback);
  }

  showAboutPanel(): void {
    const gtk = loadGtkFFI();
    const dialog = gtk.symbols.gtk_about_dialog_new(); // ponytail: no name, version or parent; needs gtk_about_dialog_set_* in gtk-ffi
    if (dialog !== null) {
      gtk.symbols.gtk_window_present(dialog);
    }
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

export const createLinuxApplication = (): NativeApplication => new LinuxApplication();

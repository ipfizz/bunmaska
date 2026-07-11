import { EventEmitter } from 'node:events';
import { makeCancelableEvent } from '../../common/cancelable-event';
import type { NativeWindow, WindowEventType } from '../platform/native';
import { ensureNativeStarted } from '../bootstrap';
import { startDevReload } from '../dev-reload';
import { nativeApp } from '../native-app';
import type { Rect } from '../platform/native';
import { app } from './app';
import { installWindowResolver, type PopupTarget } from './menu';
import { loadPreloadScript } from './preload';
import { session } from './session';
import { type LoadFileOptions, WebContents } from './web-contents';

/**
 * A top-level application window — the drop-in equivalent of Electron's
 * `BrowserWindow`. Extends Node {@link EventEmitter} (D023). Content operations
 * delegate to {@link WebContents} (D025); a process-wide registry backs the
 * `getAllWindows` / `fromId` statics.
 */

/** Per-window renderer preferences, mirroring Electron's `webPreferences`. */
export type WebPreferences = {
  /**
   * Path to a JavaScript file run before the page's own scripts, after the
   * built-in `window.__bunmaska` bridge. Resolved to an absolute path and read
   * synchronously at window construction.
   *
   * Runs in a dedicated ISOLATED JavaScript world (Electron
   * `contextIsolation: true`): it shares the page's DOM but has its own global,
   * so `window.__bunmaska`, `ipcRenderer`, and anything the preload defines are
   * invisible to page scripts. Use `contextBridge.exposeInMainWorld` to expose a
   * controlled, async, structured-clone-copyable surface to the page.
   */
  readonly preload?: string;
};

export type BrowserWindowOptions = {
  readonly width?: number;
  readonly height?: number;
  readonly title?: string;
  /** Whether to show the window immediately. Defaults to `true`. */
  readonly show?: boolean;
  /** Whether the window is user-resizable. Defaults to `true`. */
  readonly resizable?: boolean;
  /** Whether to draw the OS frame/title bar. `false` opens a frameless window. */
  readonly frame?: boolean;
  /** Whether to open in fullscreen. Defaults to `false`. */
  readonly fullscreen?: boolean;
  /** Per-window renderer preferences. */
  readonly webPreferences?: WebPreferences;
};

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const DEFAULT_TITLE = 'Bunmaska';

/** The non-preventable lifecycle events re-emitted verbatim from the seam. */
const WINDOW_EVENT_TYPES: readonly WindowEventType[] = [
  'focus',
  'blur',
  'show',
  'hide',
  'resize',
  'maximize',
  'unmaximize',
  'minimize',
  'restore',
  'ready-to-show',
];

/**
 * The event object passed to `close` listeners, mirroring Electron: a listener
 * calls {@link preventDefault} to veto the close.
 */
export type WindowCloseEvent = {
  /** Veto the pending close so the window stays open. */
  preventDefault(): void;
  /** Whether {@link preventDefault} was called. */
  readonly defaultPrevented: boolean;
};

const makeCloseEvent = (): WindowCloseEvent => {
  let prevented = false;
  return {
    preventDefault(): void {
      prevented = true;
    },
    get defaultPrevented(): boolean {
      return prevented;
    },
  };
};

const registry = new Map<number, BrowserWindow>();
/** Per-window popup targets, so `Menu.popup` can anchor to a window without a menu→window import. */
const popupTargets = new WeakMap<BrowserWindow, PopupTarget>();
let nextId = 1;

/** Installed once, in dev, so a renderer change live-reloads instead of restarting. */
let devReloadInstalled = false;

/** Reset the window registry and id counter. Test-only. */
export const resetWindowRegistryForTesting = (): void => {
  registry.clear();
  nextId = 1;
};

export class BrowserWindow extends EventEmitter {
  /** Process-unique id, matching Electron's `BrowserWindow.id`. */
  readonly id: number;
  /** The window's web contents. */
  readonly webContents: WebContents;
  readonly #native: NativeWindow;
  #destroyed = false;
  #resizable: boolean;
  #opacity = 1;
  #minWidth = 0;
  #minHeight = 0;

  constructor(options: BrowserWindowOptions = {}) {
    super();
    ensureNativeStarted();
    // In dev, the first window installs the stdin reload listener so a renderer
    // change refreshes the page in place instead of restarting the whole app.
    if (process.env['BUNMASKA_DEV'] === '1' && !devReloadInstalled) {
      devReloadInstalled = true;
      startDevReload(() => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.reload();
        }
      });
    }
    this.id = nextId;
    nextId += 1;

    this.#resizable = options.resizable ?? true;
    const preloadScript = loadPreloadScript(options.webPreferences?.preload);
    this.#native = nativeApp().createWindow({
      width: options.width ?? DEFAULT_WIDTH,
      height: options.height ?? DEFAULT_HEIGHT,
      title: options.title ?? DEFAULT_TITLE,
      show: options.show ?? true,
      ...(preloadScript !== undefined ? { preloadScript } : {}),
      ...(options.resizable !== undefined ? { resizable: options.resizable } : {}),
      ...(options.frame !== undefined ? { frame: options.frame } : {}),
      ...(options.fullscreen !== undefined ? { fullscreen: options.fullscreen } : {}),
    });
    this.webContents = new WebContents(this.#native.webContents);
    // Expose a popup target so Menu.popup can anchor a context menu to this window.
    popupTargets.set(this, {
      popupMenu: (handle, x, y) => this.#native.popupMenu(handle, x, y),
      closePopupMenu: () => this.#native.closePopupMenu(),
    });
    // Apply the effective default User-Agent before this window's first
    // navigation: a per-session override wins, else the app-wide fallback.
    const sessionUserAgent = session.defaultSession.getUserAgent();
    const effectiveUserAgent = sessionUserAgent !== '' ? sessionUserAgent : app.userAgentFallback;
    if (effectiveUserAgent !== '') {
      this.webContents.setUserAgent(effectiveUserAgent);
    }
    app.emit('web-contents-created', makeCancelableEvent(), this.webContents);

    this.#native.onClosed(() => {
      this.#destroyed = true;
      this.webContents.markDestroyed();
      registry.delete(this.id);
      this.emit('closed');
      this.#emitWindowAllClosedIfLast();
    });
    // Preventable close: re-emit Electron's `close` with an event a listener may
    // veto via preventDefault(). Returning true tells the backend to stay open.
    this.#native.onClose(() => {
      const event = makeCloseEvent();
      this.emit('close', event);
      return event.defaultPrevented;
    });
    for (const type of WINDOW_EVENT_TYPES) {
      this.#native.onWindowEvent(type, () => {
        this.emit(type);
        if (type === 'focus') {
          app.emit('browser-window-focus', makeCancelableEvent(), this);
        } else if (type === 'blur') {
          app.emit('browser-window-blur', makeCancelableEvent(), this);
        }
      });
    }
    registry.set(this.id, this);
    app.emit('browser-window-created', makeCancelableEvent(), this);
  }

  /**
   * When the last window closes, emit `app`'s `window-all-closed`. Replicating
   * Electron's default: if no listener handles it, quit the app (a subscriber
   * takes over the decision by listening).
   */
  #emitWindowAllClosedIfLast(): void {
    if (registry.size > 0) {
      return;
    }
    if (!app.emit('window-all-closed')) {
      app.quit();
    }
  }

  /** Navigate the window's web contents to a URL. */
  loadURL(url: string): void {
    this.webContents.loadURL(url);
  }

  /** Load a local file into the window's web contents. */
  loadFile(filePath: string, options?: LoadFileOptions): void {
    this.webContents.loadFile(filePath, options);
  }

  setTitle(title: string): void {
    this.#native.setTitle(title);
  }

  getTitle(): string {
    return this.#native.getTitle();
  }

  setSize(width: number, height: number): void {
    this.#native.setSize(width, height);
  }

  getBounds(): Rect {
    return this.#native.getBounds();
  }

  /** Move the window's top-left corner to `(x, y)`. */
  setPosition(x: number, y: number): void {
    this.#native.setPosition(x, y);
  }

  /** The window's `[x, y]` screen position in pixels. */
  getPosition(): [number, number] {
    const bounds = this.#native.getBounds();
    return [bounds.x, bounds.y];
  }

  /** Resize and reposition the window in one call (`{ x, y, width, height }`). */
  setBounds(bounds: Rect): void {
    this.#native.setBounds(bounds);
  }

  /** The window's `[width, height]` in pixels. */
  getSize(): [number, number] {
    const bounds = this.#native.getBounds();
    return [bounds.width, bounds.height];
  }

  /** Enable or disable user resizing of the window. */
  setResizable(resizable: boolean): void {
    this.#native.setResizable(resizable);
    this.#resizable = resizable;
  }

  /** Whether the window is user-resizable. */
  isResizable(): boolean {
    return this.#resizable;
  }

  /** Set the window opacity, clamped to `[0, 1]` (`1` = fully opaque). */
  setOpacity(opacity: number): void {
    const clamped = Math.min(1, Math.max(0, opacity));
    this.#native.setOpacity(clamped);
    this.#opacity = clamped;
  }

  /** The window's opacity in `[0, 1]`. */
  getOpacity(): number {
    return this.#opacity;
  }

  /** Constrain the window's minimum content size. */
  setMinimumSize(width: number, height: number): void {
    this.#native.setMinimumSize(width, height);
    this.#minWidth = width;
    this.#minHeight = height;
  }

  /** The window's minimum `[width, height]` (`[0, 0]` if unset). */
  getMinimumSize(): [number, number] {
    return [this.#minWidth, this.#minHeight];
  }

  /** Center the window on the current screen (best-effort on Linux/Wayland). */
  center(): void {
    this.#native.center();
  }

  show(): void {
    this.#native.show();
  }

  hide(): void {
    this.#native.hide();
  }

  isVisible(): boolean {
    return this.#native.isVisible();
  }

  focus(): void {
    this.#native.focus();
  }

  minimize(): void {
    this.#native.minimize();
  }

  maximize(): void {
    this.#native.maximize();
  }

  unmaximize(): void {
    this.#native.unmaximize();
  }

  isMaximized(): boolean {
    return this.#native.isMaximized();
  }

  isMinimized(): boolean {
    return this.#native.isMinimized();
  }

  restore(): void {
    this.#native.restore();
  }

  isFocused(): boolean {
    return this.#native.isFocused();
  }

  setFullScreen(flag: boolean): void {
    this.#native.setFullScreen(flag);
  }

  isFullScreen(): boolean {
    return this.#native.isFullScreen();
  }

  setAlwaysOnTop(flag: boolean): void {
    this.#native.setAlwaysOnTop(flag);
  }

  isDestroyed(): boolean {
    return this.#destroyed;
  }

  close(): void {
    this.#native.close();
  }

  /** Force-close the window without consulting `close` listeners. */
  destroy(): void {
    this.#native.destroy();
  }

  /** All open windows, in creation order. */
  static getAllWindows(): BrowserWindow[] {
    return [...registry.values()];
  }

  /** The window with the given id, or `undefined`. */
  static fromId(id: number): BrowserWindow | undefined {
    return registry.get(id);
  }
}

// Let Menu.popup resolve a target window (focused → most-recent) without importing
// BrowserWindow into menu.ts (which would cycle). The registry is creation-ordered.
installWindowResolver({
  focused: () => {
    for (const window of registry.values()) {
      if (window.isFocused()) {
        return popupTargets.get(window);
      }
    }
    return undefined;
  },
  mostRecent: () => {
    const windows = [...registry.values()];
    const last = windows[windows.length - 1];
    return last === undefined ? undefined : popupTargets.get(last);
  },
  resolve: (window) => (window instanceof BrowserWindow ? popupTargets.get(window) : undefined),
});

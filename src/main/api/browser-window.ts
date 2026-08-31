import { EventEmitter } from 'node:events';
import { makeCancelableEvent } from '../../common/cancelable-event';
import type { NativeWindow, WindowEventType } from '../platform/native';
import { ensureNativeStarted } from '../bootstrap';
import { startDevReload } from '../dev-reload';
import { makeDevWindowStateWriter, readDevWindowState } from '../dev-window-state';
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

export type WebPreferences = {
  /**
   * Path to a JavaScript file run before the page's own scripts, after the
   * built-in `window.__bunmaska` bridge. Read synchronously at window
   * construction.
   *
   * Runs in a dedicated ISOLATED world (Electron `contextIsolation: true`): it
   * shares the page's DOM but has its own global, so `window.__bunmaska`,
   * `ipcRenderer`, and anything the preload defines are invisible to page
   * scripts. Use `contextBridge.exposeInMainWorld` to expose a controlled,
   * async, structured-clone-copyable surface to the page.
   */
  readonly preload?: string;
};

export type BrowserWindowOptions = {
  readonly width?: number;
  readonly height?: number;
  readonly title?: string;
  /** Defaults to `true`. */
  readonly show?: boolean;
  /** Defaults to `true`. */
  readonly resizable?: boolean;
  /** `false` opens a frameless window. Defaults to `true`. */
  readonly frame?: boolean;
  /** Defaults to `false`. */
  readonly fullscreen?: boolean;
  readonly webPreferences?: WebPreferences;
};

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const DEFAULT_TITLE = 'Bunmaska';

/** Non-preventable — re-emitted verbatim from the seam. */
const WINDOW_EVENT_TYPES: readonly WindowEventType[] = [
  'focus',
  'blur',
  'show',
  'hide',
  'resize',
  'move',
  'maximize',
  'unmaximize',
  'minimize',
  'restore',
  'ready-to-show',
];

/** Passed to `close` listeners; {@link preventDefault} vetoes the close. */
export type WindowCloseEvent = {
  preventDefault(): void;
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
/** So `Menu.popup` can anchor to a window without a menu→window import cycle. */
const popupTargets = new WeakMap<BrowserWindow, PopupTarget>();
let nextId = 1;

/** Installed once, in dev, so a renderer change live-reloads instead of restarting. */
let devReloadInstalled = false;

/** @internal */
export const resetWindowRegistryForTesting = (): void => {
  registry.clear();
  nextId = 1;
};

export class BrowserWindow extends EventEmitter {
  /** Process-unique and never reused within a run. */
  readonly id: number;
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
    // Dev only: a supervisor restart is a fresh process, so the first window
    // seeds its bounds from the state file to reopen where the developer left it.
    const devStatePath = process.env['BUNMASKA_DEV_STATE'];
    const devBounds = this.id === 1 ? readDevWindowState(devStatePath) : undefined;
    if (devBounds !== undefined) {
      options = { ...options, width: devBounds.width, height: devBounds.height };
    }
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
    // Returning true tells the backend to stay open.
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
    if (devBounds !== undefined) {
      this.#native.setPosition(devBounds.x, devBounds.y);
    }
    if (devStatePath !== undefined && devStatePath !== '' && this.id === 1) {
      const write = makeDevWindowStateWriter(devStatePath, () => this.#native.getBounds());
      this.on('move', write);
      this.on('resize', write);
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

  loadURL(url: string): void {
    this.webContents.loadURL(url);
  }

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

  /** `(x, y)` is the top-left corner, in screen pixels. */
  setPosition(x: number, y: number): void {
    this.#native.setPosition(x, y);
  }

  getPosition(): [number, number] {
    const bounds = this.#native.getBounds();
    return [bounds.x, bounds.y];
  }

  setBounds(bounds: Rect): void {
    this.#native.setBounds(bounds);
  }

  getSize(): [number, number] {
    const bounds = this.#native.getBounds();
    return [bounds.width, bounds.height];
  }

  setResizable(resizable: boolean): void {
    this.#native.setResizable(resizable);
    this.#resizable = resizable;
  }

  isResizable(): boolean {
    return this.#resizable;
  }

  /** Clamped to `[0, 1]`; `1` is fully opaque. */
  setOpacity(opacity: number): void {
    const clamped = Math.min(1, Math.max(0, opacity));
    this.#native.setOpacity(clamped);
    this.#opacity = clamped;
  }

  getOpacity(): number {
    return this.#opacity;
  }

  /** Constrains the CONTENT size, not the frame. */
  setMinimumSize(width: number, height: number): void {
    this.#native.setMinimumSize(width, height);
    this.#minWidth = width;
    this.#minHeight = height;
  }

  /** `[0, 0]` if unset. */
  getMinimumSize(): [number, number] {
    return [this.#minWidth, this.#minHeight];
  }

  /** Best-effort on Linux/Wayland. */
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

  /** Skips `close` listeners, so they cannot veto. */
  destroy(): void {
    this.#native.destroy();
  }

  /** In creation order. */
  static getAllWindows(): BrowserWindow[] {
    return [...registry.values()];
  }

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

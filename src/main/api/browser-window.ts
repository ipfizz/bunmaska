import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeCancelableEvent } from '../../common/cancelable-event';
import { InvalidArgumentError } from '../../common/errors';
import type { NativeWindow, WindowEventType } from '../platform/native';
import { ensureNativeStarted } from '../bootstrap';
import { nativeApp } from '../native-app';
import type { Rect } from '../platform/native';
import { app } from './app';
import { WebContents } from './web-contents';

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
   * built-in `window.__sambar` bridge. Resolved to an absolute path and read
   * synchronously at window construction.
   *
   * Runs in a dedicated ISOLATED JavaScript world (Electron
   * `contextIsolation: true`): it shares the page's DOM but has its own global,
   * so `window.__sambar`, `ipcRenderer`, and anything the preload defines are
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

/**
 * Resolve a `webPreferences.preload` path to an absolute path and read its
 * source synchronously. Returns `undefined` when no preload is configured;
 * throws {@link InvalidArgumentError} naming the path when it cannot be read.
 */
const readPreloadScript = (preload: string | undefined): string | undefined => {
  if (preload === undefined) {
    return undefined;
  }
  const absolutePath = resolve(preload);
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch (cause) {
    throw new InvalidArgumentError(`failed to read webPreferences.preload at ${absolutePath}`, {
      cause,
    });
  }
};

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const DEFAULT_TITLE = 'Sambar';

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
let nextId = 1;

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

  constructor(options: BrowserWindowOptions = {}) {
    super();
    ensureNativeStarted();
    this.id = nextId;
    nextId += 1;

    const preloadScript = readPreloadScript(options.webPreferences?.preload);
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
    app.emit('web-contents-created', makeCancelableEvent(), this.webContents);

    this.#native.onClosed(() => {
      this.#destroyed = true;
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
  loadFile(filePath: string): void {
    this.webContents.loadFile(filePath);
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

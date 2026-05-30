import { EventEmitter } from 'node:events';
import type { NativeWindow } from '../platform/native';
import { ensureNativeStarted } from '../bootstrap';
import { nativeApp } from '../native-app';
import type { Rect } from '../platform/native';
import { WebContents } from './web-contents';

/**
 * A top-level application window — the drop-in equivalent of Electron's
 * `BrowserWindow`. Extends Node {@link EventEmitter} (D023). Content operations
 * delegate to {@link WebContents} (D025); a process-wide registry backs the
 * `getAllWindows` / `fromId` statics.
 */

export type BrowserWindowOptions = {
  readonly width?: number;
  readonly height?: number;
  readonly title?: string;
  /** Whether to show the window immediately. Defaults to `true`. */
  readonly show?: boolean;
};

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const DEFAULT_TITLE = 'Sambar';

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

    this.#native = nativeApp().createWindow({
      width: options.width ?? DEFAULT_WIDTH,
      height: options.height ?? DEFAULT_HEIGHT,
      title: options.title ?? DEFAULT_TITLE,
      show: options.show ?? true,
    });
    this.webContents = new WebContents(this.#native.webContents);

    this.#native.onClosed(() => {
      this.#destroyed = true;
      registry.delete(this.id);
      this.emit('closed');
    });
    registry.set(this.id, this);
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

  isDestroyed(): boolean {
    return this.#destroyed;
  }

  close(): void {
    this.#native.close();
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

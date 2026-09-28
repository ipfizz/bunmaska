import { EventEmitter } from 'node:events';
import { selectBackend } from '../platform/index';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linuxTrayBackend } from '../platform/linux/sni-tray';
import { macosTrayBackend } from '../platform/macos/cocoa-tray';
import { windowsTrayBackend } from '../platform/windows/windows-tray';
import { app } from './app';
import type { Menu } from './menu';
import type { NativeImage } from './native-image';

export type TrayImage = string | NativeImage;

/** Only macOS honours `template`. */
export type TrayImageOptions = { readonly template?: boolean };

export type TrayInstance = {
  setToolTip(toolTip: string): void;
  setTitle(title: string): void;
  setImage(image: string, options?: TrayImageOptions): void;
  /** `null` clears the installed menu. */
  setContextMenu(menu: Menu | null): void;
  onClick(callback: () => void): void;
  /** Must be idempotent. */
  destroy(): void;
  isDestroyed(): boolean;
};

export type TrayBackend = {
  /** `image` is a filesystem path, never a {@link NativeImage}; `appName` is `app.getName()`. */
  create(image: string, options?: TrayImageOptions, appName?: string): TrayInstance;
};

const macosBackend: TrayBackend = macosTrayBackend;
const linuxBackend: TrayBackend = linuxTrayBackend;

const { get: getBackend, setForTesting } = selectBackend<TrayBackend>('Tray', {
  macos: () => macosBackend,
  linux: () => linuxBackend,
  windows: () => windowsTrayBackend,
});

/** @internal */
export const setTrayBackendForTesting = setForTesting;

const imageOptions = (image: TrayImage): TrayImageOptions =>
  typeof image === 'string' ? {} : { template: image.isTemplateImage() };

/**
 * `click` fires on macOS only while no context menu is set: AppKit consumes the click to show
 * it. Linux needs `BUNMASKA_ENABLE_LINUX_TRAY=1`, else the tray is inert. A bad image path
 * leaves the icon unset. Every method is a no-op after {@link destroy}.
 */
export class Tray extends EventEmitter {
  #instance: TrayInstance;
  #destroyed = false;
  #iconDir: string | undefined;

  constructor(image: TrayImage) {
    super();
    this.#instance = getBackend().create(
      this.#resolveImagePath(image),
      imageOptions(image),
      app.getName(),
    );
    this.#instance.onClick(() => {
      this.emit('click');
    });
  }

  #resolveImagePath(image: TrayImage): string {
    if (typeof image === 'string') {
      return image;
    }
    this.#iconDir ??= mkdtempSync(join(tmpdir(), 'bunmaska-tray-'));
    const path = join(this.#iconDir, 'icon.png');
    writeFileSync(path, image.toPNG());
    return path;
  }

  setToolTip(toolTip: string): void {
    if (this.#destroyed) {
      return;
    }
    this.#instance.setToolTip(toolTip);
  }

  /** Text beside the icon in the macOS status bar. */
  setTitle(title: string): void {
    if (this.#destroyed) {
      return;
    }
    this.#instance.setTitle(title);
  }

  setImage(image: TrayImage): void {
    if (this.#destroyed) {
      return;
    }
    this.#instance.setImage(this.#resolveImagePath(image), imageOptions(image));
  }

  /** `null` clears it. Shown on click on macOS only; Linux and Windows accept and ignore it. */
  setContextMenu(menu: Menu | null): void {
    if (this.#destroyed) {
      return;
    }
    this.#instance.setContextMenu(menu);
  }

  /** Idempotent. */
  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#instance.destroy();
    if (this.#iconDir !== undefined) {
      rmSync(this.#iconDir, { recursive: true, force: true });
    }
  }

  isDestroyed(): boolean {
    return this.#destroyed;
  }
}

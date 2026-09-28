import { EventEmitter } from 'node:events';
import { service } from '../platform/index';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from './app';
import type { Menu } from './menu';
import type { NativeImage } from './native-image';
import type { TrayImageOptions, TrayInstance } from '../platform/services';

export type TrayImage = string | NativeImage;

const { get: getBackend, setForTesting } = service('tray');

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

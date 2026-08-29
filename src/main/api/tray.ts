import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import { linuxTrayBackend } from '../platform/linux/sni-tray';
import { macosTrayBackend } from '../platform/macos/cocoa-tray';
import { windowsTrayBackend } from '../platform/windows/windows-tray';
import type { Menu } from './menu';
import type { NativeImage } from './native-image';

export type TrayImage = string | NativeImage;

/**
 * A status-bar / system-tray icon — the drop-in equivalent of Electron's `Tray`.
 * The native status item is created eagerly in the constructor.
 *
 * Linux is a `StatusNotifierItem` over D-Bus, gated behind
 * `BUNMASKA_ENABLE_LINUX_TRAY`; without it (and in CI) the tray is an inert
 * no-op rather than a throw, so cross-platform code can construct a Tray safely.
 * {@link setContextMenu} is accepted but not yet shown on Linux or Windows.
 *
 * A bad or unreadable image path does not crash; the icon is simply not set.
 * `click` fires on macOS only when NO context menu is set — AppKit consumes the
 * click to present the menu. `right-click`/`double-click` are deferred.
 */

export type TrayInstance = {
  setToolTip(toolTip: string): void;
  setTitle(title: string): void;
  setImage(image: string): void;
  /** `null` clears the installed menu. */
  setContextMenu(menu: Menu | null): void;
  onClick(callback: () => void): void;
  /** Must be idempotent. */
  destroy(): void;
  isDestroyed(): boolean;
};

export type TrayBackend = {
  /** `image` is a filesystem path, never a {@link NativeImage}. */
  create(image: string): TrayInstance;
};

const macosBackend: TrayBackend = macosTrayBackend;
const linuxBackend: TrayBackend = linuxTrayBackend;

let backend: TrayBackend | undefined;

const getBackend = (): TrayBackend => {
  if (backend !== undefined) {
    return backend;
  }
  if (currentPlatform() === 'macos') {
    return macosBackend;
  }
  if (currentPlatform() === 'linux') {
    return linuxBackend;
  }
  if (currentPlatform() === 'windows') {
    return windowsTrayBackend;
  }
  throw new UnsupportedPlatformError(`Tray is not supported on ${currentPlatform()} yet`);
};

/** @internal */
export const setTrayBackendForTesting = (fake: TrayBackend | undefined): void => {
  backend = fake;
};

export class Tray extends EventEmitter {
  #instance: TrayInstance;
  #destroyed = false;
  #iconDir: string | undefined;

  /** A {@link NativeImage} is materialized to a temp PNG the backends load by path. */
  constructor(image: TrayImage) {
    super();
    this.#instance = getBackend().create(this.#resolveImagePath(image));
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

  /** No-op after {@link destroy}. */
  setToolTip(toolTip: string): void {
    if (this.#destroyed) {
      return;
    }
    this.#instance.setToolTip(toolTip);
  }

  /** Text beside the icon in the macOS status bar. No-op after destroy. */
  setTitle(title: string): void {
    if (this.#destroyed) {
      return;
    }
    this.#instance.setTitle(title);
  }

  /** No-op after destroy. */
  setImage(image: TrayImage): void {
    if (this.#destroyed) {
      return;
    }
    this.#instance.setImage(this.#resolveImagePath(image));
  }

  /** `null` clears it. Shown on click. No-op after destroy. */
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
  }

  isDestroyed(): boolean {
    return this.#destroyed;
  }
}

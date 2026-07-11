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

/** A Tray icon: a filesystem path, or a {@link NativeImage} (Electron parity). */
export type TrayImage = string | NativeImage;

/**
 * A status-bar / system-tray icon — the drop-in equivalent of Electron's `Tray`.
 *
 * Extends Node's {@link EventEmitter} so the listener API (`on`/`once`/…) matches
 * Electron's contract. The native status item is created eagerly in the
 * constructor and reconfigured through the forwarding methods.
 *
 * PLATFORMS:
 * - macOS: real `NSStatusItem`; works un-bundled (`bun main.ts`).
 * - Linux: a `StatusNotifierItem` exported over D-Bus (a host like KDE, the GNOME
 *   AppIndicator extension, Waybar or swaybar draws the icon). Gated behind
 *   `BUNMASKA_ENABLE_LINUX_TRAY`; without it (and in CI) the tray is an inert no-op
 *   rather than a throw, so cross-platform code constructs a Tray safely. v1 ships
 *   icon + tooltip + left-click; the context menu (a `com.canonical.dbusmenu`
 *   service) is DEFERRED, so {@link setContextMenu} is accepted but not yet shown
 *   on Linux.
 *
 * IMAGE: the constructor and {@link setImage} accept a filesystem path string to an
 * icon file. A bad/unreadable path does not crash; the icon is simply not set.
 *
 * EVENTS: `click` is emitted when the status item is activated. On macOS, when a
 * context menu is set, AppKit consumes the click to present the menu, so `click`
 * fires only when no menu is set; on Linux, the host's `Activate` drives `click`.
 * `right-click` / `double-click` are DEFERRED (not advertised) until a real event
 * source is wired.
 *
 * The native backend is injectable (mirrors `notification`/`menu`/`screen`) so
 * the class's forwarding and lifecycle are unit-testable with a fake — no FFI.
 */

/** A single live native status item the public `Tray` API drives. */
export type TrayInstance = {
  setToolTip(toolTip: string): void;
  setTitle(title: string): void;
  setImage(image: string): void;
  /** Install an `NSMenu` realized from `menu`, or clear it with `null`. */
  setContextMenu(menu: Menu | null): void;
  /** Register the callback fired when the status item is activated. */
  onClick(callback: () => void): void;
  /** Tear the status item down. Must be idempotent. */
  destroy(): void;
  isDestroyed(): boolean;
};

/** The native backend the public `Tray` API delegates to. */
export type TrayBackend = {
  /** Create a native status item for the icon at `image` (a filesystem path). */
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

/** Override the native tray backend. Test-only. */
export const setTrayBackendForTesting = (fake: TrayBackend | undefined): void => {
  backend = fake;
};

export class Tray extends EventEmitter {
  #instance: TrayInstance;
  #destroyed = false;
  #iconDir: string | undefined;

  /**
   * Create a tray with `image` — a filesystem path or a {@link NativeImage}
   * (Electron parity). A `NativeImage` is materialized to a temp PNG the native
   * backends load by path.
   */
  constructor(image: TrayImage) {
    super();
    this.#instance = getBackend().create(this.#resolveImagePath(image));
    this.#instance.onClick(() => {
      this.emit('click');
    });
  }

  /** A path stays a path; a NativeImage is written to a per-instance temp PNG. */
  #resolveImagePath(image: TrayImage): string {
    if (typeof image === 'string') {
      return image;
    }
    this.#iconDir ??= mkdtempSync(join(tmpdir(), 'bunmaska-tray-'));
    const path = join(this.#iconDir, 'icon.png');
    writeFileSync(path, image.toPNG());
    return path;
  }

  /** Set the hover tooltip. No-op after {@link destroy}. */
  setToolTip(toolTip: string): void {
    if (this.#destroyed) {
      return;
    }
    this.#instance.setToolTip(toolTip);
  }

  /** Set the text shown next to the icon (macOS status bar). No-op after destroy. */
  setTitle(title: string): void {
    if (this.#destroyed) {
      return;
    }
    this.#instance.setTitle(title);
  }

  /** Replace the icon with `image` (a filesystem path or {@link NativeImage}). No-op after destroy. */
  setImage(image: TrayImage): void {
    if (this.#destroyed) {
      return;
    }
    this.#instance.setImage(this.#resolveImagePath(image));
  }

  /** Attach a context menu (shown on click), or clear it with `null`. No-op after destroy. */
  setContextMenu(menu: Menu | null): void {
    if (this.#destroyed) {
      return;
    }
    this.#instance.setContextMenu(menu);
  }

  /** Remove the status item. Idempotent. */
  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#instance.destroy();
  }

  /** Whether {@link destroy} has been called. */
  isDestroyed(): boolean {
    return this.#destroyed;
  }
}

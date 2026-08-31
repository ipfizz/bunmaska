import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import { linuxGlobalShortcutBackend } from '../platform/linux/x11-global-shortcut';
import { macosGlobalShortcutBackend } from '../platform/macos/carbon-global-shortcut';
import { windowsGlobalShortcutBackend } from '../platform/windows/windows-global-shortcut';
import { parseAccelerator } from './accelerator';

/**
 * System-wide keyboard shortcuts — the drop-in equivalent of Electron's
 * `globalShortcut`. Backends: Carbon (macOS), X11 `XGrabKey` (Linux),
 * `RegisterHotKey` (Windows).
 *
 * Linux is X11-only. Wayland is unsupported in v1 — it needs the
 * `org.freedesktop.portal.GlobalShortcuts` desktop portal.
 */

/**
 * The API owns accelerator parsing and the `isRegistered` registry; the backend
 * owns the OS grab and dispatching `callback` when the hot key fires.
 */
export type GlobalShortcutBackend = {
  /** The HONEST per-platform answer to whether global shortcuts can be claimed. */
  isSupported(): boolean;
  /** `false` when the OS refused the grab, e.g. the key is already taken. */
  register(accelerator: string, callback: () => void): boolean;
  /** No-op if `accelerator` was not grabbed. */
  unregister(accelerator: string): void;
  unregisterAll(): void;
};

const macosBackend: GlobalShortcutBackend = macosGlobalShortcutBackend;
const linuxBackend: GlobalShortcutBackend = linuxGlobalShortcutBackend;

let backend: GlobalShortcutBackend | undefined;

const getBackend = (): GlobalShortcutBackend => {
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
    return windowsGlobalShortcutBackend;
  }
  throw new UnsupportedPlatformError(`globalShortcut is not supported on ${currentPlatform()} yet`);
};

/** @internal */
export const setGlobalShortcutBackendForTesting = (
  fake: GlobalShortcutBackend | undefined,
): void => {
  backend = fake;
};

/** Keyed by the LITERAL accelerator string, not the parsed form. */
const registry = new Set<string>();

const isParseable = (accelerator: string): boolean =>
  parseAccelerator(accelerator, currentPlatform()) !== undefined;

export type GlobalShortcut = {
  register(accelerator: string, callback: () => void): boolean;
  registerAll(accelerators: string[], callback: () => void): void;
  isRegistered(accelerator: string): boolean;
  unregister(accelerator: string): void;
  unregisterAll(): void;
};

/**
 * `false` — without touching the backend — when the accelerator is unparseable
 * or already registered, and when the OS refuses the grab.
 */
const register = (accelerator: string, callback: () => void): boolean => {
  if (!isParseable(accelerator) || registry.has(accelerator)) {
    return false;
  }
  const ok = getBackend().register(accelerator, callback);
  if (ok) {
    registry.add(accelerator);
  }
  return ok;
};

/** One shared `callback`; unparseable accelerators are skipped silently. */
const registerAll = (accelerators: string[], callback: () => void): void => {
  for (const accelerator of accelerators) {
    register(accelerator, callback);
  }
};

const isRegistered = (accelerator: string): boolean => registry.has(accelerator);

const unregister = (accelerator: string): void => {
  if (!registry.has(accelerator)) {
    return;
  }
  registry.delete(accelerator);
  getBackend().unregister(accelerator);
};

const unregisterAll = (): void => {
  if (registry.size === 0) {
    return;
  }
  registry.clear();
  getBackend().unregisterAll();
};

/** The drop-in `globalShortcut` singleton. */
export const globalShortcut: GlobalShortcut = {
  register,
  registerAll,
  isRegistered,
  unregister,
  unregisterAll,
};

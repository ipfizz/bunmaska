import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import { linuxGlobalShortcutBackend } from '../platform/linux/x11-global-shortcut';
import { macosGlobalShortcutBackend } from '../platform/macos/carbon-global-shortcut';
import { parseAccelerator } from './accelerator';

/**
 * System-wide keyboard shortcuts — the drop-in equivalent of Electron's
 * `globalShortcut`.
 *
 * The public surface mirrors Electron exactly:
 * `register` / `registerAll` / `isRegistered` / `unregister` / `unregisterAll`.
 *
 * This module is the platform-neutral core: it parses + validates accelerators
 * (rejecting unparseable ones so `register` returns `false`), tracks which
 * accelerators are live for `isRegistered`, and delegates the actual native
 * grab/handler wiring to an injectable {@link GlobalShortcutBackend}. That keeps
 * all bookkeeping unit-testable with a fake — no FFI required — and lets each
 * platform supply its own backend (Carbon on macOS, X11 `XGrabKey` on Linux).
 *
 * HONEST platform note: macOS registration works un-bundled via Carbon. Linux is
 * best-effort under X11 only — Wayland is not supported in v1 (it needs the
 * `org.freedesktop.portal.GlobalShortcuts` desktop portal). See each backend.
 */

/**
 * The native backend the public `globalShortcut` API delegates to. The API owns
 * accelerator parsing and the `isRegistered` registry; the backend owns the OS
 * grab and dispatching the JS `callback` when the hot key fires.
 */
export type GlobalShortcutBackend = {
  /** The HONEST per-platform answer to whether global shortcuts can be claimed. */
  isSupported(): boolean;
  /**
   * Claim `accelerator` at the OS level and arrange for `callback` to run when it
   * fires. Returns `false` if the OS refused the grab (e.g. already taken).
   */
  register(accelerator: string, callback: () => void): boolean;
  /** Release the OS grab for `accelerator`. No-op if it was not grabbed. */
  unregister(accelerator: string): void;
  /** Release every grab this backend holds. */
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
  throw new UnsupportedPlatformError(`globalShortcut is not supported on ${currentPlatform()} yet`);
};

/** Override the native backend. Test-only. */
export const setGlobalShortcutBackendForTesting = (
  fake: GlobalShortcutBackend | undefined,
): void => {
  backend = fake;
};

/** The accelerators currently held, keyed by their literal accelerator string. */
const registry = new Set<string>();

/** Whether the accelerator string can be parsed for the host platform. */
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
 * Register `accelerator`. Returns `false` (without touching the backend) if the
 * accelerator is unparseable or already registered, or if the OS refuses the
 * grab; `true` once the grab succeeds. Matches Electron's contract.
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

/** Register every accelerator with one shared `callback`. Unparseable ones are skipped. */
const registerAll = (accelerators: string[], callback: () => void): void => {
  for (const accelerator of accelerators) {
    register(accelerator, callback);
  }
};

/** Whether `accelerator` is currently registered by this app. */
const isRegistered = (accelerator: string): boolean => registry.has(accelerator);

/** Release `accelerator` if it is registered. No-op otherwise. */
const unregister = (accelerator: string): void => {
  if (!registry.has(accelerator)) {
    return;
  }
  registry.delete(accelerator);
  getBackend().unregister(accelerator);
};

/** Release every accelerator this app registered. */
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

import { selectBackend } from '../platform/index';
import { currentPlatform } from '../../common/platform';
import { linuxGlobalShortcutBackend } from '../platform/linux/x11-global-shortcut';
import { macosGlobalShortcutBackend } from '../platform/macos/carbon-global-shortcut';
import { windowsGlobalShortcutBackend } from '../platform/windows/windows-global-shortcut';
import { parseAccelerator } from './accelerator';

/** The API owns parsing and the registry; the backend owns the OS grab and firing `callback`. */
export type GlobalShortcutBackend = {
  /** `false` where no grab is possible, e.g. Linux without an X11 display. */
  isSupported(): boolean;
  /** `false` when the OS refused the grab, e.g. the key is already taken. */
  register(accelerator: string, callback: () => void): boolean;
  /** No-op if `accelerator` was not grabbed. */
  unregister(accelerator: string): void;
  unregisterAll(): void;
};

const macosBackend: GlobalShortcutBackend = macosGlobalShortcutBackend;
const linuxBackend: GlobalShortcutBackend = linuxGlobalShortcutBackend; // ponytail: X11 only; Wayland needs the GlobalShortcuts portal

const { get: getBackend, setForTesting } = selectBackend<GlobalShortcutBackend>('globalShortcut', {
  macos: () => macosBackend,
  linux: () => linuxBackend,
  windows: () => windowsGlobalShortcutBackend,
});

/** @internal */
export const setGlobalShortcutBackendForTesting = setForTesting;

/** Canonical form to the literal the backend was given, which is what it keys its grab by. */
const registry = new Map<string, string>();

/** `CmdOrCtrl+K` and `CommandOrControl+k` share one key; `undefined` if unparseable. */
const canonical = (accelerator: string): string | undefined => {
  const p = parseAccelerator(accelerator, currentPlatform());
  return p && [p.ctrl, p.alt, p.shift, p.meta, p.super].map(Number).join('') + p.key;
};

export type GlobalShortcut = {
  register(accelerator: string, callback: () => void): boolean;
  registerAll(accelerators: string[], callback: () => void): void;
  isRegistered(accelerator: string): boolean;
  unregister(accelerator: string): void;
  unregisterAll(): void;
};

/** `false` when the OS refuses the grab, or, without a grab, when unsupported, unparseable or taken. */
const register = (accelerator: string, callback: () => void): boolean => {
  const key = canonical(accelerator);
  if (key === undefined || registry.has(key) || !getBackend().isSupported()) {
    return false;
  }
  const ok = getBackend().register(accelerator, callback);
  if (ok) {
    registry.set(key, accelerator);
  }
  return ok;
};

/** One shared `callback`; unparseable accelerators are skipped silently. */
const registerAll = (accelerators: string[], callback: () => void): void => {
  for (const accelerator of accelerators) {
    register(accelerator, callback);
  }
};

const isRegistered = (accelerator: string): boolean => registry.has(canonical(accelerator) ?? '');

const unregister = (accelerator: string): void => {
  const key = canonical(accelerator) ?? '';
  const registered = registry.get(key);
  if (registered === undefined) {
    return;
  }
  registry.delete(key);
  getBackend().unregister(registered);
};

const unregisterAll = (): void => {
  if (registry.size === 0) {
    return;
  }
  registry.clear();
  getBackend().unregisterAll();
};

export const globalShortcut: GlobalShortcut = {
  register,
  registerAll,
  isRegistered,
  unregister,
  unregisterAll,
};

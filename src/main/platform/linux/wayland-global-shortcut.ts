import type { Pointer } from 'bun:ffi';
import { parseAccelerator } from '../../../common/accelerator';
import type { GlobalShortcutBackend } from '../services';
import { callMethodSync, probeSessionBusUnchecked } from './linux-dbus';
import { isWaylandSession } from './x11-global-shortcut';

const PORTAL_NAME = 'org.freedesktop.portal.Desktop';
const PORTAL_PATH = '/org/freedesktop/portal/desktop';
const SHORTCUTS_IFACE = 'org.freedesktop.portal.GlobalShortcuts';

const registry = new Map<string, () => void>();

/** A portal shortcut id derived from the accelerator. Pure. */
export const shortcutIdFor = (accelerator: string): string =>
  `bunmaska.${accelerator.replace(/[^A-Za-z0-9]+/g, '-')}`;

export const isWaylandShortcutsSupported = (
  env: Readonly<Record<string, string | undefined>> = process.env,
  bus: () => Pointer | null = probeSessionBusUnchecked,
): boolean => isWaylandSession(env) && bus() !== null;

const register = (accelerator: string, callback: () => void): boolean => {
  if (parseAccelerator(accelerator, 'linux') === undefined || !isWaylandShortcutsSupported()) {
    return false;
  }
  const bus = probeSessionBusUnchecked();
  if (bus === null) {
    return false;
  }
  registry.set(accelerator, callback);
  // CreateSession wants a{sv}; a null body is refused cleanly (callMethodSync never aborts).
  callMethodSync(bus, PORTAL_NAME, PORTAL_PATH, SHORTCUTS_IFACE, 'CreateSession', null);
  return true;
};

const unregister = (accelerator: string): void => {
  registry.delete(accelerator);
};

const unregisterAll = (): void => {
  registry.clear();
};

export const waylandGlobalShortcutBackend: GlobalShortcutBackend = {
  isSupported: () => isWaylandShortcutsSupported(),
  register,
  unregister,
  unregisterAll,
};

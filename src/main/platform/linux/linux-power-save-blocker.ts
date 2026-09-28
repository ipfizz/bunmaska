import { type Pointer, ptr } from 'bun:ffi';
import type { NativeBlocker, PowerSaveBlockerBackend, PowerSaveBlockerType } from '../services';
import { cstr } from '../cstr';
import { loadGlibFFI } from './glib-ffi';
import { callMethodSync, getSessionBus } from './linux-dbus';

// D038: both types map to ScreenSaver idle inhibition on the gated session bus.
// ponytail: 'prevent-app-suspension' does not block lid or explicit sleep; logind Inhibit('sleep') is the upgrade.

const SS_NAME = 'org.freedesktop.ScreenSaver';
const SS_PATH = '/org/freedesktop/ScreenSaver';
const SS_IFACE = 'org.freedesktop.ScreenSaver';
const INHIBIT = 'Inhibit';
const UNINHIBIT = 'UnInhibit';

const reasonFor = (type: PowerSaveBlockerType): string =>
  type === 'prevent-display-sleep' ? 'Preventing display sleep' : 'Preventing app suspension';

const inhibitArgs = (app: string, reason: string): Pointer | null => {
  const glib = loadGlibFFI();
  const a = glib.symbols.g_variant_new_string(cstr(app));
  const r = glib.symbols.g_variant_new_string(cstr(reason));
  if (a === null || r === null) {
    return null;
  }
  const children = new BigUint64Array([BigInt(a), BigInt(r)]);
  return glib.symbols.g_variant_new_tuple(ptr(children), 2n); // sinks a, r
};

const uninhibitArgs = (cookie: number): Pointer | null => {
  const glib = loadGlibFFI();
  const c = glib.symbols.g_variant_new_uint32(cookie);
  if (c === null) {
    return null;
  }
  const children = new BigUint64Array([BigInt(c)]);
  return glib.symbols.g_variant_new_tuple(ptr(children), 1n);
};

/** Type-guarded: `g_variant_get_uint32` on a non-`u` child ABORTS. */
const readCookie = (reply: Pointer): number | null => {
  const glib = loadGlibFFI();
  if (glib.symbols.g_variant_n_children(reply) < 1n) {
    return null;
  }
  const child = glib.symbols.g_variant_get_child_value(reply, 0n);
  if (child === null) {
    return null;
  }
  try {
    if (glib.symbols.g_variant_get_type_string(child)?.toString() !== 'u') {
      return null;
    }
    return glib.symbols.g_variant_get_uint32(child);
  } finally {
    glib.symbols.g_variant_unref(child);
  }
};

const acquire = (type: PowerSaveBlockerType, appName = 'Bunmaska'): NativeBlocker | null => {
  const bus = getSessionBus();
  if (bus === null) {
    return null;
  }
  const args = inhibitArgs(appName, reasonFor(type));
  if (args === null) {
    return null;
  }
  const reply = callMethodSync(bus, SS_NAME, SS_PATH, SS_IFACE, INHIBIT, args);
  if (reply === null) {
    return null;
  }
  try {
    return readCookie(reply);
  } finally {
    loadGlibFFI().symbols.g_variant_unref(reply); // call_sync reply is transfer-full.
  }
};

const release = (handle: NativeBlocker): void => {
  const bus = getSessionBus();
  if (bus === null) {
    return;
  }
  const args = uninhibitArgs(handle as number);
  if (args === null) {
    return;
  }
  const reply = callMethodSync(bus, SS_NAME, SS_PATH, SS_IFACE, UNINHIBIT, args);
  if (reply !== null) {
    loadGlibFFI().symbols.g_variant_unref(reply); // transfer-full, even when empty.
  }
};

export const linuxPowerSaveBlockerBackend: PowerSaveBlockerBackend = { acquire, release };

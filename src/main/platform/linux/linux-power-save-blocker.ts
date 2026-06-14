import { type Pointer, ptr } from 'bun:ffi';
import type {
  NativeBlocker,
  PowerSaveBlockerBackend,
  PowerSaveBlockerType,
} from '../../api/power-save-blocker';
import { cstr } from '../cstr';
import { loadGlibFFI } from './glib-ffi';
import { callMethodSync, getSessionBus } from './linux-dbus';

/**
 * Linux power-save blocker via `org.freedesktop.ScreenSaver` inhibition (session bus).
 *
 * v1 maps BOTH types to ScreenSaver `Inhibit(app, reason) -> u cookie`; `UnInhibit(cookie)`
 * releases. This is the freedesktop fallback Chromium itself uses and avoids ALL fd /
 * GUnixFDList complexity (a plain u32 cookie, not a Unix fd). Documented coarseness:
 * 'prevent-app-suspension' uses the same idle inhibition as 'prevent-display-sleep' — it
 * blocks idle-triggered sleep but is slightly less authoritative than logind's
 * `Inhibit(what='sleep')` fd path (a future upgrade), which also blocks lid/explicit sleep.
 *
 * DEADLOCK-SAFE: the only blocking call is the bounded {@link callMethodSync} (5s timeout),
 * whose reply is delivered by GIO's private worker thread, not Bunmaska's pump. CI-HANG-SAFE:
 * gated behind `BUNMASKA_ENABLE_LINUX_POWER_BLOCKER` (CI never sets it), so `getSessionBus()`
 * returns null and `acquire` is a no-op (`start()` still returns an id).
 */

const SS_NAME = 'org.freedesktop.ScreenSaver';
const SS_PATH = '/org/freedesktop/ScreenSaver';
const SS_IFACE = 'org.freedesktop.ScreenSaver';
const INHIBIT = 'Inhibit';
const UNINHIBIT = 'UnInhibit';
const APP_NAME = 'Bunmaska';

const reasonFor = (type: PowerSaveBlockerType): string =>
  type === 'prevent-display-sleep' ? 'Preventing display sleep' : 'Preventing app suspension';

/** Build the floating `(ss)` arg tuple for Inhibit (consumed by callMethodSync). */
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

/** Build the floating `(u)` arg tuple for UnInhibit. */
const uninhibitArgs = (cookie: number): Pointer | null => {
  const glib = loadGlibFFI();
  const c = glib.symbols.g_variant_new_uint32(cookie);
  if (c === null) {
    return null;
  }
  const children = new BigUint64Array([BigInt(c)]);
  return glib.symbols.g_variant_new_tuple(ptr(children), 1n);
};

/** Read the `u` cookie out of an `(u)` reply tuple, guarding type (a wrong type ABORTS). */
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

const acquire = (type: PowerSaveBlockerType): NativeBlocker | null => {
  const bus = getSessionBus();
  if (bus === null) {
    return null; // gate off / no session bus → no-op (start() still returns an id).
  }
  const args = inhibitArgs(APP_NAME, reasonFor(type));
  if (args === null) {
    return null;
  }
  const reply = callMethodSync(bus, SS_NAME, SS_PATH, SS_IFACE, INHIBIT, args);
  if (reply === null) {
    return null; // no ScreenSaver impl, or it errored/timed out.
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
    loadGlibFFI().symbols.g_variant_unref(reply); // UnInhibit returns an empty tuple; still unref.
  }
};

/** The Linux power-save-blocker backend (org.freedesktop.ScreenSaver inhibition). */
export const linuxPowerSaveBlockerBackend: PowerSaveBlockerBackend = { acquire, release };

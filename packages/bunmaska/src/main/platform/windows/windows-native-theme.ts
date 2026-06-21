import { ptr, read } from 'bun:ffi';
import { wstr } from './win32';
import { HKEY_CURRENT_USER, loadAdvapi32, RRF_RT_REG_DWORD } from './win32-registry-ffi';

/**
 * Windows system-appearance reads for `nativeTheme`, the WinCairo peer of
 * `cocoa-native-theme.ts` / `gtk-native-theme.ts`. Windows exposes the user's
 * light/dark preference as the `AppsUseLightTheme` REG_DWORD under the per-user
 * `Themes\Personalize` key (`0` = dark, `1`/absent = light) — the same signal
 * Electron reads. Observing live theme changes (a `RegNotifyChangeKeyValue` /
 * `WM_SETTINGCHANGE` watcher) is a documented follow-up; this reads on demand.
 */

const PERSONALIZE_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
const APPS_USE_LIGHT_THEME = 'AppsUseLightTheme';

/** Buffer sizes for a `REG_DWORD` read: 4 data bytes + a 4-byte size cell. */
const DWORD_BYTES = 4;

/**
 * Read a `REG_DWORD` value under `HKEY_CURRENT_USER`, or `undefined` if the key /
 * value is absent or not a DWORD. `read.u32` takes the value straight from the
 * native output buffer (a `DataView` over the JS array would not see the write).
 */
export const readRegistryDwordCurrentUser = (subkey: string, value: string): number | undefined => {
  const subkeyBuf = wstr(subkey); // held alive across the FFI call
  const valueBuf = wstr(value);
  const data = new Uint8Array(DWORD_BYTES);
  const size = new Uint8Array(DWORD_BYTES);
  new DataView(size.buffer).setUint32(0, DWORD_BYTES, true);
  const dataPtr = ptr(data);
  const rc = loadAdvapi32().symbols.RegGetValueW(
    HKEY_CURRENT_USER,
    ptr(subkeyBuf),
    ptr(valueBuf),
    RRF_RT_REG_DWORD,
    null,
    dataPtr,
    ptr(size),
  );
  return rc === 0 ? read.u32(dataPtr, 0) : undefined;
};

/**
 * Whether Windows requests a dark app appearance: `AppsUseLightTheme === 0`. A
 * missing value (the user never changed the default) reads as light.
 */
export const windowsShouldUseDarkColors = (): boolean =>
  readRegistryDwordCurrentUser(PERSONALIZE_KEY, APPS_USE_LIGHT_THEME) === 0;

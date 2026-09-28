import { ptr, read } from 'bun:ffi';
import { wstr } from './win32';
import { HKEY_CURRENT_USER, loadAdvapi32, RRF_RT_REG_DWORD } from './win32-registry-ffi';

const PERSONALIZE_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
const APPS_USE_LIGHT_THEME = 'AppsUseLightTheme';

const DWORD_BYTES = 4;

/** A `REG_DWORD` under `HKEY_CURRENT_USER`, or `undefined` if absent or not a DWORD. */
export const readRegistryDwordCurrentUser = (subkey: string, value: string): number | undefined => {
  const subkeyBuf = wstr(subkey);
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

// ponytail: read on demand; live changes need RegNotifyChangeKeyValue or WM_SETTINGCHANGE
/** `AppsUseLightTheme === 0`; an absent value (the default was never changed) reads as light. */
export const windowsShouldUseDarkColors = (): boolean =>
  readRegistryDwordCurrentUser(PERSONALIZE_KEY, APPS_USE_LIGHT_THEME) === 0;

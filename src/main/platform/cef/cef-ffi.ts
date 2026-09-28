import { CFunction, FFIType, type Pointer, ptr, read, toArrayBuffer } from 'bun:ffi';
import { dlopen } from '../dlopen';

/**
 * CEF's C API, pinned to one API version. Every struct below is LP64
 * (macOS/Linux) at CEF_API_VERSION 15400, measured with
 * `clang -DCEF_API_VERSION=15400 -Xclang -fdump-record-layouts` against the CEF
 * headers. A struct's leading `size` is how CEF tells versions apart, so the
 * numbers must match the version passed to `cef_api_hash`, never a newer header.
 */
export const CEF_API_VERSION = 15400;

export const SIZE = {
  settings: 448,
  browserSettings: 264,
  windowInfo: 96,
  app: 80,
  browserProcessHandler: 96,
  client: 192,
  lifeSpanHandler: 88,
  loadHandler: 72,
  displayHandler: 144,
  devToolsObserver: 80,
  mainArgs: 16,
} as const;

export const SETTINGS = {
  noSandbox: 8,
  browserSubprocessPath: 16,
  frameworkDirPath: 40,
  mainBundlePath: 64,
  multiThreadedMessageLoop: 88,
  externalMessagePump: 92,
  cachePath: 104,
  rootCachePath: 128,
  persistSessionCookies: 152,
  logSeverity: 256,
} as const;

export const WINDOW_INFO = { bounds: 32, parentView: 56, runtimeStyle: 88 } as const;
export const RUNTIME_STYLE_ALLOY = 2;
export const LOG_SEVERITY_ERROR = 4;

export const APP = { onBeforeCommandLineProcessing: 40, getBrowserProcessHandler: 64 } as const;
export const COMMAND_LINE = {
  getSwitchValue: 136,
  appendSwitch: 152,
  appendSwitchWithValue: 160,
} as const;
export const BROWSER_PROCESS_HANDLER = {
  onContextInitialized: 48,
  onAlreadyRunningAppRelaunch: 64,
  onScheduleMessagePumpWork: 72,
};
export const CLIENT = { getDisplayHandler: 72, getLifeSpanHandler: 144, getLoadHandler: 152 };
export const LIFE_SPAN = { onBeforePopup: 40, onAfterCreated: 64, doClose: 72, onBeforeClose: 80 };
export const LOAD = { onLoadingStateChange: 40, onLoadEnd: 56, onLoadError: 64 } as const;
export const DISPLAY = { onAddressChange: 40, onTitleChange: 48 } as const;
export const DEVTOOLS_OBSERVER = { onDevToolsMessage: 40 } as const;
export const BASE = { release: 16 } as const;
export const BROWSER = {
  getHost: 48,
  canGoBack: 56,
  goBack: 64,
  canGoForward: 72,
  goForward: 80,
  reload: 96,
  reloadIgnoreCache: 104,
  stopLoad: 112,
  getIdentifier: 120,
} as const;
export const HOST = {
  closeBrowser: 48,
  setFocus: 72,
  setZoomLevel: 160,
  showDevTools: 224,
  closeDevTools: 232,
  sendDevToolsMessage: 248,
  addDevToolsMessageObserver: 264,
} as const;
export const FRAME = { isMain: 160 } as const;
export const COOKIE_MANAGER = { flushStore: 72 } as const;
export const PREFERENCE_MANAGER = { setPreference: 72 } as const;
export const VALUE = { setString: 184 } as const;

const openCef = (path: string) =>
  dlopen(path, {
    cef_api_hash: { args: [FFIType.i32, FFIType.i32], returns: FFIType.ptr },
    cef_initialize: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    cef_do_message_loop_work: { args: [], returns: FFIType.void },
    cef_cookie_manager_get_global_manager: { args: [FFIType.ptr], returns: FFIType.ptr },
    cef_preference_manager_get_global: { args: [], returns: FFIType.ptr },
    cef_value_create: { args: [], returns: FFIType.ptr },
    cef_string_userfree_utf16_free: { args: [FFIType.ptr], returns: FFIType.void },
    cef_browser_host_create_browser_sync: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.ptr,
    },
  });

export type CefLibrary = ReturnType<typeof openCef>;

let library: CefLibrary | undefined;

/** Open libcef once per process; a second call must name the same path. */
export const loadCef = (path: string): CefLibrary => {
  library ??= openCef(path);
  return library;
};

/** The already-opened libcef. Throws before {@link loadCef}. */
export const cefLibrary = (): CefLibrary => {
  if (library === undefined) {
    throw new Error('CEF used before loadCef()');
  }
  return library;
};

/** Structs CEF keeps pointers to live for the whole process (see cef-glue). */
const immortal: unknown[] = [];

/** A zeroed buffer that is never freed, and its address. */
export const allocImmortal = (size: number): { readonly buf: Buffer; readonly at: Pointer } => {
  const buf = Buffer.alloc(size);
  immortal.push(buf);
  return { buf, at: addressOf(buf) };
};

/** Keep a JSCallback (or anything CEF points into) alive for the process. */
export const retainForever = (value: unknown): void => {
  immortal.push(value);
};

export const addressOf = (buf: Uint8Array): Pointer => ptr(buf);

export const setPtr = (buf: Buffer, offset: number, value: number | bigint): void => {
  buf.writeBigUInt64LE(BigInt(value), offset);
};

/**
 * Write a `cef_string_t` (UTF-16 `{str, length, dtor}`) into `buf`. The text
 * lives in `keep`, which must outlive the CEF call that copies it.
 */
export const writeCefString = (
  buf: Buffer,
  offset: number,
  value: string,
  keep: unknown[],
): void => {
  const data = Buffer.from(`${value}\0`, 'utf16le');
  keep.push(data);
  setPtr(buf, offset, ptr(data));
  setPtr(buf, offset + 8, value.length);
  setPtr(buf, offset + 16, 0);
};

const utf16 = new TextDecoder('utf-16le');

/** Read a borrowed `const cef_string_t*` (NULL reads as `''`). */
export const readCefString = (at: number): string => {
  if (at === 0) {
    return '';
  }
  const str = read.ptr(at as Pointer, 0);
  const length = Number(read.u64(at as Pointer, 8));
  if (str === 0 || length === 0) {
    return '';
  }
  return utf16.decode(toArrayBuffer(str as Pointer, 0, length * 2));
};

type FFITypeValue = (typeof FFIType)[keyof typeof FFIType];
const methods = new Map<string, (...args: unknown[]) => unknown>();

/**
 * Call method `offset` of the CEF object at `self` (`self->method(self, ...)`).
 * CFunctions are cached per function pointer + signature, so a vtable shared
 * by every browser costs one wrapper.
 */
export const callMethod = (
  self: number,
  offset: number,
  args: readonly FFITypeValue[],
  returns: FFITypeValue,
  ...values: unknown[]
): unknown => {
  const fn = read.ptr(self as Pointer, offset);
  const key = `${fn}|${args.join(',')}|${returns}`;
  let method = methods.get(key);
  if (method === undefined) {
    const created = CFunction({ ptr: fn as Pointer, args: [FFIType.ptr, ...args], returns });
    method = created as unknown as (...args: unknown[]) => unknown;
    methods.set(key, method);
  }
  return method(self, ...values);
};

/** Drop the reference CEF handed us with an argument or return value. */
export const release = (object: number): void => {
  if (object !== 0) {
    callMethod(object, BASE.release, [], FFIType.i32);
  }
};

/** Coerce a pointer-ish FFI value (number, bigint or null) to a number. */
export const toAddress = (value: unknown): number => Number(value ?? 0);

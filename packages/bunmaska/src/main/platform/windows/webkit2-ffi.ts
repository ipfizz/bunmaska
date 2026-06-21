import { dlopen, FFIType, ptr } from 'bun:ffi';
import { FFIError } from '../../../common/errors';
import { winLibraryAccessor, wstr } from './win32';
import { loadKernel32 } from './win32-ffi';

/**
 * WinCairo WebKit2 C API FFI for the Windows backend — the engine half.
 *
 * Windows ships no system WebKit, so the engine is brought in via the engine
 * store and loaded from its own directory. WebKit2 exposes a flat-C API
 * (`WK*`-prefixed, `extern "C"`, `WK_EXPORT`'d from `WebKit2.dll`) — NOT COM — so
 * every entry point binds directly with `dlopen`/`JSCallback`, the same idiom the
 * GTK/Cocoa backends use. Opaque `WK*Ref` handles are plain pointers (`ptr`);
 * `size_t` is `u64` on x64; the win-only `WKViewCreate` takes a 16-byte `RECT` by
 * value, which the Windows x64 ABI passes by hidden pointer, so it binds as `ptr`.
 *
 * Engine resolution is the bootstrap shape for now: the dir comes from
 * `BUNMASKA_WEBKIT_PATH`, and the dir is put on the DLL search path so
 * `WebKit2.dll`'s dependency closure (ICU, libcurl, ANGLE, ...) resolves beside
 * it. The content-addressed engine-store resolution replaces this later (D041).
 */

const WEBKIT2_SYMBOLS = {
  // ── Context + configuration ──────────────────────────────────────────────
  WKContextConfigurationCreate: { args: [], returns: FFIType.ptr },
  WKContextCreateWithConfiguration: { args: [FFIType.ptr], returns: FFIType.ptr },
  WKPageConfigurationCreate: { args: [], returns: FFIType.ptr },
  WKPageConfigurationSetContext: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
  WKPageConfigurationSetUserContentController: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },
  WKPageConfigurationGetPreferences: { args: [FFIType.ptr], returns: FFIType.ptr },
  WKPreferencesSetJavaScriptEnabled: { args: [FFIType.ptr, FFIType.u8], returns: FFIType.void },

  // ── View (hosted in an HWND) ─────────────────────────────────────────────
  // WKViewCreate(RECT rect, WKPageConfigurationRef, HWND parent): RECT is 16
  // bytes -> passed by hidden pointer on the Win64 ABI, so `rect` binds as ptr.
  WKViewCreate: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.ptr },
  WKViewGetPage: { args: [FFIType.ptr], returns: FFIType.ptr },
  WKViewGetWindow: { args: [FFIType.ptr], returns: FFIType.u64 },
  WKViewSetIsInWindow: { args: [FFIType.ptr, FFIType.u8], returns: FFIType.void },
  WKViewSetParentWindow: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.void },

  // ── Navigation + history ─────────────────────────────────────────────────
  WKPageLoadURL: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
  WKPageLoadHTMLString: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
  WKPageReload: { args: [FFIType.ptr], returns: FFIType.void },
  WKPageReloadFromOrigin: { args: [FFIType.ptr], returns: FFIType.void },
  WKPageStopLoading: { args: [FFIType.ptr], returns: FFIType.void },
  WKPageGoBack: { args: [FFIType.ptr], returns: FFIType.void },
  WKPageGoForward: { args: [FFIType.ptr], returns: FFIType.void },
  WKPageCanGoBack: { args: [FFIType.ptr], returns: FFIType.bool },
  WKPageCanGoForward: { args: [FFIType.ptr], returns: FFIType.bool },
  WKPageCopyActiveURL: { args: [FFIType.ptr], returns: FFIType.ptr },
  WKPageCopyTitle: { args: [FFIType.ptr], returns: FFIType.ptr },
  // (page, script, void* context, completion) — context+completion passed NULL for
  // fire-and-forget eval; executeJavaScript results return out-of-band (D022).
  WKPageEvaluateJavaScriptInMainFrame: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },
  WKPageSetPageZoomFactor: { args: [FFIType.ptr, FFIType.f64], returns: FFIType.void },
  WKPageSetCustomUserAgent: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },

  // ── User content: document-start injection + the renderer->main bridge ────
  WKUserContentControllerCreate: { args: [], returns: FFIType.ptr },
  WKUserContentControllerAddUserScript: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },
  WKUserContentControllerRemoveAllUserScripts: { args: [FFIType.ptr], returns: FFIType.void },
  // (ucc, WKStringRef name, WKScriptMessageHandlerCallback, const void* context)
  WKUserContentControllerAddScriptMessageHandler: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },
  WKUserContentControllerRemoveAllUserMessageHandlers: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  // (WKStringRef source, _WKUserScriptInjectionTime, bool forMainFrameOnly)
  WKUserScriptCreateWithSource: {
    args: [FFIType.ptr, FFIType.i32, FFIType.u8],
    returns: FFIType.ptr,
  },
  WKScriptMessageGetBody: { args: [FFIType.ptr], returns: FFIType.ptr },

  // ── Strings / URLs ───────────────────────────────────────────────────────
  WKStringCreateWithUTF8CString: { args: [FFIType.cstring], returns: FFIType.ptr },
  WKStringGetMaximumUTF8CStringSize: { args: [FFIType.ptr], returns: FFIType.u64 },
  WKStringGetUTF8CString: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
  WKURLCreateWithUTF8CString: { args: [FFIType.cstring], returns: FFIType.ptr },
  WKURLCopyString: { args: [FFIType.ptr], returns: FFIType.ptr },

  // ── Reference counting ───────────────────────────────────────────────────
  WKRetain: { args: [FFIType.ptr], returns: FFIType.ptr },
  WKRelease: { args: [FFIType.ptr], returns: FFIType.void },
} as const;

/** `_WKUserScriptInjectionTime`: inject before the page's own scripts run. */
export const WK_INJECT_AT_DOCUMENT_START = 0;
/** `_WKUserScriptInjectionTime`: inject after the document has parsed. */
export const WK_INJECT_AT_DOCUMENT_END = 1;

/** The directory of the WinCairo WebKit engine this process loads, or `undefined`. */
export const resolveWindowsEngineDir = (): string | undefined => {
  const dir = process.env['BUNMASKA_WEBKIT_PATH'];
  return dir !== undefined && dir.length > 0 ? dir : undefined;
};

/**
 * Open the engine's `WebKit2.dll` and return its symbol table. Memoised;
 * import-safe (throws on non-Windows via the accessor). Puts the engine dir on
 * the DLL search path first so the bundled closure resolves beside `WebKit2.dll`.
 */
export const loadWebKit2 = winLibraryAccessor('WebKit2', () => {
  const dir = resolveWindowsEngineDir();
  if (dir === undefined) {
    throw new FFIError(
      'no WinCairo WebKit engine configured (set BUNMASKA_WEBKIT_PATH to an engine directory)',
    );
  }
  loadKernel32().symbols.SetDllDirectoryW(ptr(wstr(dir)));
  return dlopen(`${dir}\\WebKit2.dll`, WEBKIT2_SYMBOLS);
});

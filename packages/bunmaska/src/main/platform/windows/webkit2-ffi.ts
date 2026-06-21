import { dlopen, FFIType, ptr } from 'bun:ffi';
import { FFIError } from '../../../common/errors';
import { type ResolveDeps, resolveEngineWith } from '../../engine/resolve';
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
 * Engine resolution reuses the cross-platform {@link resolveEngineWith} (the same
 * resolver the Linux loaders use): `BUNMASKA_WEBKIT_PATH` (explicit dir) >
 * `BUNMASKA_WEBKIT_ID` (env id) > the baked `engine.id` next to the executable >
 * the content-addressed store. Unlike Linux there is NO system-WebKit fallback —
 * Windows ships none — so any `system` outcome means "no engine" here. The chosen
 * dir is put on the DLL search path so `WebKit2.dll`'s dependency closure (ICU,
 * libcurl, ANGLE, ...) resolves beside it.
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
  // (page, const WKPageNavigationClientBase*) — register navigation lifecycle callbacks.
  WKPageSetPageNavigationClient: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },

  // ── Errors (for did-fail-load) ───────────────────────────────────────────
  WKErrorGetErrorCode: { args: [FFIType.ptr], returns: FFIType.i32 },
  WKErrorCopyLocalizedDescription: { args: [FFIType.ptr], returns: FFIType.ptr },

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

/**
 * The directory of the WinCairo WebKit engine this process loads (the engine's
 * `lib/` for a store pin, or the verbatim `BUNMASKA_WEBKIT_PATH`), or `undefined`
 * when nothing is pinned/installed — there is no system WebKit to fall back to on
 * Windows. Delegates to {@link resolveEngineWith}; `deps` is a test seam.
 */
export const resolveWindowsEngineDir = (deps: ResolveDeps = {}): string | undefined => {
  const resolution = resolveEngineWith(deps);
  return resolution.mode === 'pinned' ? resolution.libDir : undefined;
};

/**
 * Open the engine's `WebKit2.dll` and return its symbol table. Memoised;
 * import-safe (throws on non-Windows via the accessor). Puts the engine dir on
 * the DLL search path first so the bundled closure resolves beside `WebKit2.dll`.
 * A pinned-but-uninstalled engine surfaces the resolver's warning in the error.
 */
export const loadWebKit2 = winLibraryAccessor('WebKit2', () => {
  const resolution = resolveEngineWith();
  const dir = resolution.mode === 'pinned' ? resolution.libDir : undefined;
  if (dir === undefined) {
    const detail = resolution.warnings.length > 0 ? ` (${resolution.warnings.join('; ')})` : '';
    throw new FFIError(
      `no WinCairo WebKit engine configured${detail}; ` +
        'set BUNMASKA_WEBKIT_PATH or pin an installed engine',
    );
  }
  loadKernel32().symbols.SetDllDirectoryW(ptr(wstr(dir)));
  return dlopen(`${dir}\\WebKit2.dll`, WEBKIT2_SYMBOLS);
});

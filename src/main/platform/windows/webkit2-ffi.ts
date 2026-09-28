import { FFIType, ptr } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FFIError } from '../../../common/errors';
import { type ResolveDeps, resolveEngineWith } from '../../engine/resolve';
import { winLibraryAccessor, wstr } from './win32';
import { loadKernel32 } from './win32-ffi';

// Opaque `WK*Ref` handles bind as `ptr`; `size_t` is `u64` on x64. Windows ships no system
// WebKit, so a `system` resolution means "no engine" here.

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

  // ── View (hosted in an HWND) ─────────────────────────────────────────────
  // WKViewCreate(RECT rect, WKPageConfigurationRef, HWND parent): RECT is 16
  // bytes -> passed by hidden pointer on the Win64 ABI, so `rect` binds as ptr.
  WKViewCreate: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.ptr },
  WKViewGetPage: { args: [FFIType.ptr], returns: FFIType.ptr },
  WKViewGetWindow: { args: [FFIType.ptr], returns: FFIType.u64 },
  WKViewSetIsInWindow: { args: [FFIType.ptr, FFIType.u8], returns: FFIType.void },

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
  // (page, script, void* context, completion): both NULL; executeJavaScript results
  // return out-of-band over a script message (D022b).
  WKPageEvaluateJavaScriptInMainFrame: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },
  WKPageSetPageZoomFactor: { args: [FFIType.ptr, FFIType.f64], returns: FFIType.void },
  WKPageSetCustomUserAgent: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
  // (page, const WKPageNavigationClientBase*); NULL clears it.
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
  // (ucc, WKStringRef name, callback, const void* context); the callback is
  // (WKScriptMessageRef, WKCompletionListenerRef reply, const void* context).
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
  WKScriptMessageGetFrameInfo: { args: [FFIType.ptr], returns: FFIType.ptr },
  WKFrameInfoGetIsMainFrame: { args: [FFIType.ptr], returns: FFIType.bool },
  // (WKCompletionListenerRef, WKTypeRef reply): NULL resolves the page's postMessage promise.
  WKCompletionListenerComplete: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },

  // ── Strings / URLs ───────────────────────────────────────────────────────
  // WKTypeID is uint32_t.
  WKGetTypeID: { args: [FFIType.ptr], returns: FFIType.u32 },
  WKStringGetTypeID: { args: [], returns: FFIType.u32 },
  WKStringCreateWithUTF8CString: { args: [FFIType.cstring], returns: FFIType.ptr },
  WKStringGetMaximumUTF8CStringSize: { args: [FFIType.ptr], returns: FFIType.u64 },
  // NonStrict replaces a lone surrogate; the strict variant returns 0 and drops the whole string.
  WKStringGetUTF8CStringNonStrict: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u64],
    returns: FFIType.u64,
  },
  WKURLCreateWithUTF8CString: { args: [FFIType.cstring], returns: FFIType.ptr },
  WKURLCopyString: { args: [FFIType.ptr], returns: FFIType.ptr },

  // ── Website data (used by the session backend) ───────────────────────────
  // () -> WKWebsiteDataStoreRef, the process-wide default store.
  WKWebsiteDataStoreGetDefaultDataStore: { args: [], returns: FFIType.ptr },
  // (WKWebsiteDataStoreRef) -> WKHTTPCookieStoreRef
  WKWebsiteDataStoreGetHTTPCookieStore: { args: [FFIType.ptr], returns: FFIType.ptr },
  // (WKHTTPCookieStoreRef, void* context, callback(void* context)) -> void, async.
  WKHTTPCookieStoreDeleteAllCookies: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },
  // (WKWebsiteDataStoreRef, void* context, callback(void* context)) -> void, async.
  WKWebsiteDataStoreRemoveAllFetchCaches: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },

  // ── Reference counting ───────────────────────────────────────────────────
  WKRelease: { args: [FFIType.ptr], returns: FFIType.void },
} as const;

/** `_WKUserScriptInjectionTime`: inject before the page's own scripts run. */
export const WK_INJECT_AT_DOCUMENT_START = 0;

/** The subdir an embedded engine is bundled into (must match `build-windows.ts`). */
const BUNDLED_ENGINE_DIRNAME = 'webkit';

/** `<exeDir>/webkit/` if it holds `WebKit2.dll` (from `build --embed-engine`), else `undefined`. */
export const bundledEngineDir = (
  execPath: string,
  exists: (path: string) => boolean,
): string | undefined => {
  const dir = join(dirname(execPath), BUNDLED_ENGINE_DIRNAME);
  return exists(join(dir, 'WebKit2.dll')) ? dir : undefined;
};

/** The engine dir to load: a pin beats a {@link bundledEngineDir}; `undefined` if neither. */
export const resolveWindowsEngineDir = (
  deps: ResolveDeps & { readonly execPath?: string } = {},
): string | undefined => {
  const resolution = resolveEngineWith(deps);
  if (resolution.mode === 'pinned') {
    return resolution.libDir;
  }
  return bundledEngineDir(deps.execPath ?? process.execPath, deps.exists ?? existsSync);
};

/** Memoised `WebKit2.dll` symbols; the engine dir goes on the DLL search path for its closure. */
export const loadWebKit2 = winLibraryAccessor('WebKit2', () => {
  // Never resolveEngineWith alone: it misses the engine bundled next to the executable.
  const dir = resolveWindowsEngineDir();
  if (dir === undefined) {
    const detail = resolveEngineWith().warnings.join('; ');
    throw new FFIError(
      `no WinCairo WebKit engine configured${detail.length > 0 ? ` (${detail})` : ''}; bundle one ` +
        'with `bunmaska build --embed-engine`, set BUNMASKA_WEBKIT_PATH, or pin an installed engine',
    );
  }
  loadKernel32().symbols.SetDllDirectoryW(ptr(wstr(dir)));
  return dlopen(`${dir}\\WebKit2.dll`, WEBKIT2_SYMBOLS);
});

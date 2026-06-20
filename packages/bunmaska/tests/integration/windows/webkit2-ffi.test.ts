import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  wkRelease,
  wkString,
  wkStringToJs,
  wkUrl,
  wkUrlToJs,
} from '../../../src/main/platform/windows/webkit-string';
import {
  loadWebKit2,
  resolveWindowsEngineDir,
} from '../../../src/main/platform/windows/webkit2-ffi';

/**
 * Windows + engine only. Drives the REAL WinCairo WebKit2.dll via bun:ffi:
 * loads the engine + its dependency closure, creates a context, and round-trips
 * strings/URLs. Skipped unless BUNMASKA_WEBKIT_PATH points at an engine dir.
 */
const hasEngine = currentPlatform() === 'windows' && resolveWindowsEngineDir() !== undefined;

describe.skipIf(!hasEngine)('WinCairo WebKit2 FFI', () => {
  test('loads WebKit2.dll and resolves the core WK2 symbols', () => {
    const wk = loadWebKit2();
    expect(typeof wk.symbols.WKViewCreate).toBe('function');
    expect(typeof wk.symbols.WKPageLoadURL).toBe('function');
    expect(typeof wk.symbols.WKUserContentControllerAddScriptMessageHandler).toBe('function');
    expect(typeof wk.symbols.WKUserScriptCreateWithSource).toBe('function');
  });

  test('loadWebKit2 is idempotent (same library handle)', () => {
    expect(loadWebKit2()).toBe(loadWebKit2());
  });

  test('creates a real WKContext from a configuration', () => {
    const wk = loadWebKit2();
    const cfg = wk.symbols.WKContextConfigurationCreate();
    expect(cfg).not.toBeNull();
    const ctx = wk.symbols.WKContextCreateWithConfiguration(cfg);
    expect(ctx).not.toBeNull();
    wkRelease(ctx);
    wkRelease(cfg);
  });

  test('round-trips a JS string (incl. astral chars) through WKString', () => {
    const ref = wkString('hello-bunmaska-\u{1f98a}');
    try {
      expect(wkStringToJs(ref)).toBe('hello-bunmaska-\u{1f98a}');
    } finally {
      wkRelease(ref);
    }
  });

  test('round-trips a URL through WKURL', () => {
    const ref = wkUrl('https://example.com/path');
    try {
      expect(wkUrlToJs(ref)).toBe('https://example.com/path');
    } finally {
      wkRelease(ref);
    }
  });
});

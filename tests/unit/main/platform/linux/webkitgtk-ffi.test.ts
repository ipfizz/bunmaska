import { FFIType } from 'bun:ffi';
import { describe, expect, it } from 'bun:test';
import {
  loadWebKitGtkFFI,
  readGetUriResult,
  WEBKIT_LOAD_FINISHED,
  WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES,
  WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
  WEBKITGTK_FFI_SYMBOLS,
} from '../../../../../src/main/platform/linux/webkitgtk-ffi';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';

describe('loadWebKitGtkFFI', () => {
  it('throws UnsupportedPlatformError on non-Linux platforms', () => {
    if (currentPlatform() === 'linux') {
      return;
    }
    expect(() => loadWebKitGtkFFI()).toThrow(UnsupportedPlatformError);
  });
});

describe('WEBKITGTK_FFI_SYMBOLS (shape-only ABI assertions)', () => {
  it('declares load_html base_uri as a nullable pointer (BUG1 fix)', () => {
    expect(WEBKITGTK_FFI_SYMBOLS.webkit_web_view_load_html.args).toEqual([
      FFIType.pointer,
      FFIType.cstring,
      FFIType.pointer,
    ]);
    expect(WEBKITGTK_FFI_SYMBOLS.webkit_web_view_load_html.args[2]).toBe(FFIType.pointer);
  });

  it('returns a guardable pointer (not cstring) from get_uri (BUG2 fix)', () => {
    expect(WEBKITGTK_FFI_SYMBOLS.webkit_web_view_get_uri.returns).toBe(FFIType.pointer);
  });

  it('declares evaluate_javascript as the 8-arg WK6.0 form with i64 length', () => {
    const sym = WEBKITGTK_FFI_SYMBOLS.webkit_web_view_evaluate_javascript;
    expect(sym.args.length).toBe(8);
    expect(sym.args[0]).toBe(FFIType.pointer);
    expect(sym.args[1]).toBe(FFIType.cstring);
    expect(sym.args[2]).toBe(FFIType.i64);
    expect(sym.args[3]).toBe(FFIType.pointer);
    expect(sym.args[4]).toBe(FFIType.pointer);
    expect(sym.returns).toBe(FFIType.void);
  });

  it('declares register_script_message_handler as the 3-arg WK6.0 form', () => {
    const sym = WEBKITGTK_FFI_SYMBOLS.webkit_user_content_manager_register_script_message_handler;
    expect(sym.args.length).toBe(3);
    expect(sym.args).toEqual([FFIType.pointer, FFIType.cstring, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.i32);
  });

  it('declares user_script_new as (cstring, i32, i32, ptr, ptr) -> ptr', () => {
    expect(WEBKITGTK_FFI_SYMBOLS.webkit_user_script_new.args).toEqual([
      FFIType.cstring,
      FFIType.i32,
      FFIType.i32,
      FFIType.pointer,
      FFIType.pointer,
    ]);
    expect(WEBKITGTK_FFI_SYMBOLS.webkit_user_script_new.returns).toBe(FFIType.pointer);
  });

  it('declares get_type as () -> u64 (GType for the construct-only path)', () => {
    expect(WEBKITGTK_FFI_SYMBOLS.webkit_web_view_get_type.args).toEqual([]);
    expect(WEBKITGTK_FFI_SYMBOLS.webkit_web_view_get_type.returns).toBe(FFIType.u64);
  });

  it('returns i32 (gboolean) from can_go_back/can_go_forward', () => {
    expect(WEBKITGTK_FFI_SYMBOLS.webkit_web_view_can_go_back.returns).toBe(FFIType.i32);
    expect(WEBKITGTK_FFI_SYMBOLS.webkit_web_view_can_go_forward.returns).toBe(FFIType.i32);
  });
});

describe('WebKit enum constants', () => {
  it('has the expected integer values (CI-RISK: confirm against the .so)', () => {
    expect(WEBKIT_LOAD_FINISHED).toBe(3);
    expect(WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES).toBe(0);
    expect(WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START).toBe(0);
  });
});

describe('readGetUriResult', () => {
  it('returns "" for a NULL pointer (transfer-none, never freed)', () => {
    expect(readGetUriResult(null)).toBe('');
  });
});

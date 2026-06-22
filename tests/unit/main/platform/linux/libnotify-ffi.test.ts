import { FFIType } from 'bun:ffi';
import { describe, expect, it } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import {
  LIBNOTIFY_FFI_SYMBOLS,
  loadLibnotifyFFI,
} from '../../../../../src/main/platform/linux/libnotify-ffi';

describe('loadLibnotifyFFI', () => {
  it('throws UnsupportedPlatformError on non-Linux platforms', () => {
    if (currentPlatform() === 'linux') {
      return;
    }
    expect(() => loadLibnotifyFFI()).toThrow(UnsupportedPlatformError);
  });
});

describe('LIBNOTIFY_FFI_SYMBOLS (shape-only ABI assertions)', () => {
  it('declares notify_init as [cstring] -> i32 (gboolean)', () => {
    const sym = LIBNOTIFY_FFI_SYMBOLS.notify_init;
    expect(sym.args).toEqual([FFIType.cstring]);
    expect(sym.returns).toBe(FFIType.i32);
  });

  it('declares notify_is_initted as [] -> i32 (gboolean)', () => {
    const sym = LIBNOTIFY_FFI_SYMBOLS.notify_is_initted;
    expect(sym.args).toEqual([]);
    expect(sym.returns).toBe(FFIType.i32);
  });

  it('declares notify_notification_new as [cstring, cstring, cstring] -> ptr', () => {
    const sym = LIBNOTIFY_FFI_SYMBOLS.notify_notification_new;
    expect(sym.args).toEqual([FFIType.cstring, FFIType.cstring, FFIType.cstring]);
    expect(sym.returns).toBe(FFIType.pointer);
  });

  it('declares notify_notification_show as [ptr, ptr (GError**)] -> i32 (gboolean)', () => {
    const sym = LIBNOTIFY_FFI_SYMBOLS.notify_notification_show;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.i32);
  });

  it('declares notify_notification_close as [ptr, ptr (GError**)] -> i32 (gboolean)', () => {
    const sym = LIBNOTIFY_FFI_SYMBOLS.notify_notification_close;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.pointer]);
    expect(sym.returns).toBe(FFIType.i32);
  });

  it('declares notify_notification_set_timeout as [ptr, i32] -> void', () => {
    const sym = LIBNOTIFY_FFI_SYMBOLS.notify_notification_set_timeout;
    expect(sym.args).toEqual([FFIType.pointer, FFIType.i32]);
    expect(sym.returns).toBe(FFIType.void);
  });
});

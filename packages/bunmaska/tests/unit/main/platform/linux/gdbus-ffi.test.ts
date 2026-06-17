import { FFIType } from 'bun:ffi';
import { describe, expect, it } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import {
  DBUS_CALL_TIMEOUT_MS,
  DBUS_SIGNAL_CB_DEF,
  G_BUS_TYPE_SESSION,
  G_BUS_TYPE_SYSTEM,
  G_DBUS_SIGNAL_FLAGS_NONE,
  GDBUS_FFI_SYMBOLS,
  loadGDBusFFI,
} from '../../../../../src/main/platform/linux/gdbus-ffi';

/**
 * Shape-only unit tests for the GDBus FFI table — assert the ABI without `dlopen`,
 * so they run on any host (the real symbol resolution is the Linux integration test).
 */
describe('GDBUS_FFI_SYMBOLS (ABI shape)', () => {
  it('g_bus_get_sync is (GBusType i32, cancellable ptr, error ptr) -> ptr', () => {
    expect(GDBUS_FFI_SYMBOLS.g_bus_get_sync.args).toEqual([
      FFIType.i32,
      FFIType.pointer,
      FFIType.pointer,
    ]);
    expect(GDBUS_FFI_SYMBOLS.g_bus_get_sync.returns).toBe(FFIType.pointer);
  });

  it('g_dbus_connection_signal_subscribe has flags(u32) before the callback and returns guint(u32)', () => {
    expect(GDBUS_FFI_SYMBOLS.g_dbus_connection_signal_subscribe.args).toEqual([
      FFIType.pointer,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.u32,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
    ]);
    expect(GDBUS_FFI_SYMBOLS.g_dbus_connection_signal_subscribe.returns).toBe(FFIType.u32);
  });

  it('g_dbus_connection_signal_unsubscribe is (conn ptr, id u32) -> void', () => {
    expect(GDBUS_FFI_SYMBOLS.g_dbus_connection_signal_unsubscribe.args).toEqual([
      FFIType.pointer,
      FFIType.u32,
    ]);
    expect(GDBUS_FFI_SYMBOLS.g_dbus_connection_signal_unsubscribe.returns).toBe(FFIType.void);
  });

  it('the GDBusSignalCallback ABI is 7 pointers -> void, and the enum constants are right', () => {
    expect(DBUS_SIGNAL_CB_DEF.args).toEqual(['ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr']);
    expect(DBUS_SIGNAL_CB_DEF.returns).toBe('void');
    expect(G_BUS_TYPE_SYSTEM).toBe(1);
    expect(G_BUS_TYPE_SESSION).toBe(2);
    expect(G_DBUS_SIGNAL_FLAGS_NONE).toBe(0);
  });

  it('g_dbus_connection_call_sync has 11 args (timeout i32, returns ptr) with a finite timeout', () => {
    expect(GDBUS_FFI_SYMBOLS.g_dbus_connection_call_sync.args).toEqual([
      FFIType.pointer,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.u32,
      FFIType.i32,
      FFIType.pointer,
      FFIType.pointer,
    ]);
    expect(GDBUS_FFI_SYMBOLS.g_dbus_connection_call_sync.returns).toBe(FFIType.pointer);
    expect(DBUS_CALL_TIMEOUT_MS).toBe(5000);
    // Must be a finite backstop, never the infinite G_MAXINT (2147483647).
    expect(DBUS_CALL_TIMEOUT_MS).toBeLessThan(2_147_483_647);
  });
});

describe('loadGDBusFFI platform guard', () => {
  it('throws UnsupportedPlatformError when not on Linux', () => {
    if (currentPlatform() !== 'linux') {
      expect(() => loadGDBusFFI()).toThrow(UnsupportedPlatformError);
    }
  });
});

import { CFunction, type FFITypeOrString, type JSCallback, type Pointer, ptr } from 'bun:ffi';
import { describe, expect, it, test } from 'bun:test';
import { type LogRecord, resetLogger, setLogSink } from '../../../../../src/common/logger';
import type { NativeNavigationEvent } from '../../../../../src/main/platform/native';
import {
  CLOSE_REQUEST_CB_DEF,
  closeRequestDecision,
  CREATE_CB_DEF,
  deferCallbackClose,
  DESTROY_CB_DEF,
  LOAD_CHANGED_CB_DEF,
  LOAD_FAILED_CB_DEF,
  makeCloseRequestCallback,
  makeLoadCallbacks,
  makeNotifyCallback,
  NOTIFY_CB_DEF,
  SCRIPT_MESSAGE_CB_DEF,
  SignalRegistry,
} from '../../../../../src/main/platform/linux/gtk-signals';
import {
  WEBKIT_LOAD_COMMITTED,
  WEBKIT_LOAD_FINISHED,
  WEBKIT_LOAD_STARTED,
} from '../../../../../src/main/platform/linux/webkitgtk-ffi';

const noop = (): void => undefined;

/** Invoke a JSCallback through its native thunk, as GLib would. */
const nativeCall = (
  cb: JSCallback,
  def: { args: readonly FFITypeOrString[]; returns: FFITypeOrString },
) => {
  if (cb.ptr === null) {
    throw new Error('no thunk');
  }
  return CFunction({ ptr: cb.ptr, args: [...def.args], returns: def.returns });
};

describe('gtk-signals callback ABI definitions (shape-only)', () => {
  it('close-request returns i32 (inverted gboolean) with two pointer args', () => {
    expect(CLOSE_REQUEST_CB_DEF.args).toEqual(['ptr', 'ptr']);
    expect(CLOSE_REQUEST_CB_DEF.returns).toBe('i32');
  });

  it('destroy is (ptr, ptr) -> void', () => {
    expect(DESTROY_CB_DEF.args).toEqual(['ptr', 'ptr']);
    expect(DESTROY_CB_DEF.returns).toBe('void');
  });

  it('load-changed second arg is i32 (the WebKitLoadEvent)', () => {
    expect(LOAD_CHANGED_CB_DEF.args).toEqual(['ptr', 'i32', 'ptr']);
    expect(LOAD_CHANGED_CB_DEF.args[1]).toBe('i32');
    expect(LOAD_CHANGED_CB_DEF.returns).toBe('void');
  });

  it('load-failed is (self, load_event, uri, error, user_data) -> i32', () => {
    expect(LOAD_FAILED_CB_DEF.args).toEqual(['ptr', 'i32', 'ptr', 'ptr', 'ptr']);
    expect(LOAD_FAILED_CB_DEF.returns).toBe('i32');
  });

  it('create is (self, navigation_action, user_data) -> ptr (the new view or NULL)', () => {
    expect(CREATE_CB_DEF.args).toEqual(['ptr', 'ptr', 'ptr']);
    expect(CREATE_CB_DEF.returns).toBe('ptr');
  });

  it('script-message takes three pointers (WK6.0 JSCValue* direct)', () => {
    expect(SCRIPT_MESSAGE_CB_DEF.args).toEqual(['ptr', 'ptr', 'ptr']);
    expect(SCRIPT_MESSAGE_CB_DEF.returns).toBe('void');
  });

  it('notify is (gobject, pspec, user_data) -> void: three pointers', () => {
    expect(NOTIFY_CB_DEF.args).toEqual(['ptr', 'ptr', 'ptr']);
    expect(NOTIFY_CB_DEF.returns).toBe('void');
  });
});

describe('closeRequestDecision (preventable close, GTK semantics)', () => {
  it('returns 1 (veto, stay open) when the close request is vetoed', () => {
    expect(closeRequestDecision(() => true)).toBe(1);
  });

  it('returns 0 (allow GTK to destroy) when not vetoed', () => {
    expect(closeRequestDecision(() => false)).toBe(0);
  });
});

describe('gtk-signals JSCallback factories (constructible + closable)', () => {
  it('builds a close-request callback exposing a native ptr', () => {
    const cb = makeCloseRequestCallback(() => false);
    expect(typeof cb.ptr).toBe('number');
    cb.close();
  });

  it('builds a notify callback exposing a native ptr', () => {
    const cb = makeNotifyCallback(noop);
    expect(typeof cb.ptr).toBe('number');
    cb.close();
  });
});

describe('a throwing handler never unwinds into GLib', () => {
  const boom = (): never => {
    throw new Error('boom');
  };

  test('a throwing notify handler returns normally and logs the error', () => {
    const records: LogRecord[] = [];
    setLogSink((record) => records.push(record));
    const cb = makeNotifyCallback(boom);
    try {
      expect(() => nativeCall(cb, NOTIFY_CB_DEF)(null, null, null)).not.toThrow();
      expect(records.map((r) => r.level)).toContain('error');
    } finally {
      cb.close();
      resetLogger();
    }
  });

  test('a throwing close-request handler allows the close (returns 0)', () => {
    const cb = makeCloseRequestCallback(boom);
    try {
      expect(nativeCall(cb, CLOSE_REQUEST_CB_DEF)(null, null)).toBe(0);
    } finally {
      cb.close();
    }
  });
});

describe('makeLoadCallbacks', () => {
  const record = () => {
    const events: NativeNavigationEvent[] = [];
    const { changed, failed } = makeLoadCallbacks((event) => events.push(event));
    const loadChanged = nativeCall(changed, LOAD_CHANGED_CB_DEF);
    const loadFailed = nativeCall(failed, LOAD_FAILED_CB_DEF);
    return {
      events,
      emitChanged: (loadEvent: number) => loadChanged(null, loadEvent, null),
      emitFailed: (error: Pointer | null) => loadFailed(null, 0, null, error, null),
      close: () => {
        changed.close();
        failed.close();
      },
    };
  };

  /** A hand-built 64-bit `GError { GQuark domain; gint code; gchar *message }`. */
  const gError = (code: number, message: string): { ptr: Pointer; keep: unknown[] } => {
    const text = Buffer.from(`${message}\0`);
    const buf = new ArrayBuffer(16);
    const view = new DataView(buf);
    view.setUint32(0, 1, true);
    view.setInt32(4, code, true);
    view.setBigUint64(8, BigInt(ptr(text)), true);
    return { ptr: ptr(buf), keep: [text, buf] };
  };

  test('a successful load emits start, navigate, finish, stop', () => {
    const load = record();
    load.emitChanged(WEBKIT_LOAD_STARTED);
    load.emitChanged(WEBKIT_LOAD_COMMITTED);
    load.emitChanged(WEBKIT_LOAD_FINISHED);
    load.close();
    expect(load.events.map((e) => e.type)).toEqual([
      'did-start-loading',
      'did-navigate',
      'did-finish-load',
      'did-stop-loading',
    ]);
  });

  test('a failed load never emits did-finish-load for the FINISHED that follows it', () => {
    const load = record();
    const error = gError(302, 'Load request cancelled');
    load.emitChanged(WEBKIT_LOAD_STARTED);
    load.emitFailed(error.ptr);
    load.emitChanged(WEBKIT_LOAD_FINISHED);
    load.close();
    expect(load.events).toEqual([
      { type: 'did-start-loading' },
      { type: 'did-fail-load', errorCode: 302, errorDescription: 'Load request cancelled' },
      { type: 'did-stop-loading' },
    ]);
  });

  test('the next load after a failure finishes normally', () => {
    const load = record();
    load.emitFailed(null);
    load.emitChanged(WEBKIT_LOAD_FINISHED);
    load.emitChanged(WEBKIT_LOAD_STARTED);
    load.emitChanged(WEBKIT_LOAD_FINISHED);
    load.close();
    expect(load.events.map((e) => e.type)).toEqual([
      'did-fail-load',
      'did-stop-loading',
      'did-start-loading',
      'did-finish-load',
      'did-stop-loading',
    ]);
  });

  test('a NULL GError reports code -1 with an empty description', () => {
    const load = record();
    load.emitFailed(null);
    load.close();
    expect(load.events[0]).toEqual({ type: 'did-fail-load', errorCode: -1, errorDescription: '' });
  });
});

describe('SignalRegistry', () => {
  it('starts empty and disconnectAll is a no-op when empty', () => {
    const registry = new SignalRegistry();
    expect(registry.size).toBe(0);
    expect(() => registry.disconnectAll()).not.toThrow();
    expect(registry.size).toBe(0);
  });
});

describe('deferCallbackClose (never close a thunk inside its own invocation)', () => {
  it('does not close synchronously; closes only when the scheduled task runs', () => {
    let closed = 0;
    const cb = { close: () => (closed += 1) };
    let scheduled: (() => void) | undefined;
    deferCallbackClose([cb], (fn) => {
      scheduled = fn;
    });
    expect(closed).toBe(0);
    scheduled?.();
    expect(closed).toBe(1);
  });

  it('is a no-op (does not schedule) for an empty list', () => {
    let scheduledCount = 0;
    deferCallbackClose([], () => {
      scheduledCount += 1;
    });
    expect(scheduledCount).toBe(0);
  });

  it('closes every callback in the batch on the deferred tick', () => {
    const closes: number[] = [];
    const cbs = [0, 1, 2].map((i) => ({ close: () => closes.push(i) }));
    let scheduled: (() => void) | undefined;
    deferCallbackClose(cbs, (fn) => {
      scheduled = fn;
    });
    scheduled?.();
    expect(closes).toEqual([0, 1, 2]);
  });
});

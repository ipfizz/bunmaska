import { describe, expect, it } from 'bun:test';
import {
  CLOSE_REQUEST_CB_DEF,
  closeRequestDecision,
  CREATE_CB_DEF,
  deferCallbackClose,
  DESTROY_CB_DEF,
  LOAD_CHANGED_CB_DEF,
  LOAD_FAILED_CB_DEF,
  makeCloseRequestCallback,
  makeDestroyCallback,
  makeLoadChangedCallback,
  makeLoadFailedCallback,
  makeNotifyCallback,
  NOTIFY_CB_DEF,
  SCRIPT_MESSAGE_CB_DEF,
  SignalRegistry,
} from '../../../../../src/main/platform/linux/gtk-signals';

const noop = (): void => undefined;

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

  it('builds destroy, load-changed, and load-failed callbacks without throwing', () => {
    const destroy = makeDestroyCallback(noop);
    const loadChanged = makeLoadChangedCallback(noop);
    const loadFailed = makeLoadFailedCallback(noop);
    expect(typeof destroy.ptr).toBe('number');
    expect(typeof loadChanged.ptr).toBe('number');
    expect(typeof loadFailed.ptr).toBe('number');
    destroy.close();
    loadChanged.close();
    loadFailed.close();
  });

  it('builds a notify callback exposing a native ptr', () => {
    const cb = makeNotifyCallback(noop);
    expect(typeof cb.ptr).toBe('number');
    cb.close();
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

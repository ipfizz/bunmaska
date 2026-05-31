import { describe, expect, it } from 'bun:test';
import {
  CLOSE_REQUEST_CB_DEF,
  DESTROY_CB_DEF,
  LOAD_CHANGED_CB_DEF,
  makeCloseRequestCallback,
  makeDestroyCallback,
  makeLoadChangedCallback,
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

  it('script-message takes three pointers (WK6.0 JSCValue* direct)', () => {
    expect(SCRIPT_MESSAGE_CB_DEF.args).toEqual(['ptr', 'ptr', 'ptr']);
    expect(SCRIPT_MESSAGE_CB_DEF.returns).toBe('void');
  });
});

describe('gtk-signals JSCallback factories (constructible + closable)', () => {
  it('builds a close-request callback exposing a native ptr', () => {
    const cb = makeCloseRequestCallback(noop);
    expect(typeof cb.ptr).toBe('number');
    cb.close();
  });

  it('builds destroy and load-changed callbacks without throwing', () => {
    const destroy = makeDestroyCallback(noop);
    const loadChanged = makeLoadChangedCallback(noop);
    expect(typeof destroy.ptr).toBe('number');
    expect(typeof loadChanged.ptr).toBe('number');
    destroy.close();
    loadChanged.close();
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

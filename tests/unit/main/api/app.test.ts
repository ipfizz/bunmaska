import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'bun:test';
import { App, app } from '../../../../src/main/api/app';

describe('App singleton', () => {
  test('is an instance of App', () => {
    expect(app).toBeInstanceOf(App);
  });

  test('is a Node EventEmitter for Electron compatibility', () => {
    expect(app).toBeInstanceOf(EventEmitter);
  });
});

describe('App.isReady', () => {
  test('is false on a fresh instance', () => {
    expect(new App().isReady).toBe(false);
  });

  test('is true after markReady', () => {
    const a = new App();
    a.markReady();
    expect(a.isReady).toBe(true);
  });
});

describe('App.markReady', () => {
  test('emits ready exactly once when called multiple times', () => {
    const a = new App();
    let calls = 0;
    a.on('ready', () => {
      calls += 1;
    });
    a.markReady();
    a.markReady();
    a.markReady();
    expect(calls).toBe(1);
  });

  test('fires handlers registered before markReady', () => {
    const a = new App();
    let fired = false;
    a.on('ready', () => {
      fired = true;
    });
    a.markReady();
    expect(fired).toBe(true);
  });

  test('does not fire handlers registered after markReady', () => {
    const a = new App();
    a.markReady();
    let fired = false;
    a.on('ready', () => {
      fired = true;
    });
    expect(fired).toBe(false);
  });
});

describe('App.whenReady', () => {
  test('resolves immediately when already ready', async () => {
    const a = new App();
    a.markReady();
    await a.whenReady();
  });

  test('resolves after markReady when called before', async () => {
    const a = new App();
    const promise = a.whenReady();
    a.markReady();
    await promise;
  });

  test('invokes the start hook on first call when not ready', () => {
    const a = new App();
    let started = 0;
    a.setStartHook(() => {
      started += 1;
    });
    void a.whenReady();
    expect(started).toBe(1);
  });

  test('a start hook that marks ready resolves whenReady', async () => {
    const a = new App();
    a.setStartHook(() => a.markReady());
    await a.whenReady();
    expect(a.isReady).toBe(true);
  });
});

describe('App event surface', () => {
  test('before-quit handlers can be registered', () => {
    const a = new App();
    a.on('before-quit', () => undefined);
    expect(a.listenerCount('before-quit')).toBe(1);
  });

  test('window-all-closed handlers can be registered', () => {
    const a = new App();
    a.on('window-all-closed', () => undefined);
    expect(a.listenerCount('window-all-closed')).toBe(1);
  });

  test('supports the Electron addListener/removeListener alias surface', () => {
    const a = new App();
    const handler = (): void => undefined;
    a.addListener('will-quit', handler);
    expect(a.listenerCount('will-quit')).toBe(1);
    a.removeListener('will-quit', handler);
    expect(a.listenerCount('will-quit')).toBe(0);
  });
});

describe('App.quit', () => {
  test('emits before-quit, will-quit, then quit in order', () => {
    const a = new App();
    const order: string[] = [];
    a.on('before-quit', () => order.push('before-quit'));
    a.on('will-quit', () => order.push('will-quit'));
    a.on('quit', () => order.push('quit'));
    a.quit();
    expect(order).toEqual(['before-quit', 'will-quit', 'quit']);
  });
});

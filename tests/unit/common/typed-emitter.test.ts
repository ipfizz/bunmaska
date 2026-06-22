import { describe, expect, test } from 'bun:test';
import { TypedEmitter } from '../../../src/common/typed-emitter';

type TestEvents = {
  click: readonly [x: number, y: number];
  ready: readonly [];
  error: readonly [err: Error];
};

describe('TypedEmitter.on / emit', () => {
  test('emit calls registered handler with the provided args', () => {
    const e = new TypedEmitter<TestEvents>();
    const calls: Array<readonly [number, number]> = [];
    e.on('click', (x, y) => calls.push([x, y]));

    e.emit('click', 3, 4);

    expect(calls).toEqual([[3, 4]]);
  });

  test('emit returns true when there were listeners', () => {
    const e = new TypedEmitter<TestEvents>();
    e.on('ready', () => undefined);
    expect(e.emit('ready')).toBe(true);
  });

  test('emit returns false when there were no listeners', () => {
    const e = new TypedEmitter<TestEvents>();
    expect(e.emit('ready')).toBe(false);
  });

  test('multiple handlers are called in registration order', () => {
    const e = new TypedEmitter<TestEvents>();
    const order: number[] = [];
    e.on('ready', () => order.push(1));
    e.on('ready', () => order.push(2));
    e.on('ready', () => order.push(3));

    e.emit('ready');

    expect(order).toEqual([1, 2, 3]);
  });
});

describe('TypedEmitter.off', () => {
  test('removes a specific handler', () => {
    const e = new TypedEmitter<TestEvents>();
    const calls: number[] = [];
    const handler = (): void => {
      calls.push(1);
    };
    e.on('ready', handler);
    e.off('ready', handler);
    e.emit('ready');
    expect(calls).toEqual([]);
  });

  test('only removes the matching handler, not others on the same event', () => {
    const e = new TypedEmitter<TestEvents>();
    const calls: number[] = [];
    const a = (): void => {
      calls.push(1);
    };
    const b = (): void => {
      calls.push(2);
    };
    e.on('ready', a);
    e.on('ready', b);
    e.off('ready', a);
    e.emit('ready');
    expect(calls).toEqual([2]);
  });
});

describe('TypedEmitter.once', () => {
  test('handler fires exactly once', () => {
    const e = new TypedEmitter<TestEvents>();
    const calls: number[] = [];
    e.once('ready', () => calls.push(1));

    e.emit('ready');
    e.emit('ready');
    e.emit('ready');

    expect(calls).toEqual([1]);
  });

  test('receives the args from the first emit', () => {
    const e = new TypedEmitter<TestEvents>();
    const captured: Array<readonly [number, number]> = [];
    e.once('click', (x, y) => captured.push([x, y]));

    e.emit('click', 10, 20);
    e.emit('click', 30, 40);

    expect(captured).toEqual([[10, 20]]);
  });
});

describe('TypedEmitter.listenerCount', () => {
  test('returns 0 for unknown events', () => {
    const e = new TypedEmitter<TestEvents>();
    expect(e.listenerCount('ready')).toBe(0);
  });

  test('reflects added and removed handlers', () => {
    const e = new TypedEmitter<TestEvents>();
    const h = (): void => undefined;
    e.on('ready', h);
    expect(e.listenerCount('ready')).toBe(1);
    e.off('ready', h);
    expect(e.listenerCount('ready')).toBe(0);
  });
});

describe('TypedEmitter.removeAllListeners', () => {
  test('removes listeners for a specific event only', () => {
    const e = new TypedEmitter<TestEvents>();
    e.on('ready', () => undefined);
    e.on('click', () => undefined);

    e.removeAllListeners('ready');

    expect(e.listenerCount('ready')).toBe(0);
    expect(e.listenerCount('click')).toBe(1);
  });

  test('removes listeners for all events when no event is provided', () => {
    const e = new TypedEmitter<TestEvents>();
    e.on('ready', () => undefined);
    e.on('click', () => undefined);

    e.removeAllListeners();

    expect(e.listenerCount('ready')).toBe(0);
    expect(e.listenerCount('click')).toBe(0);
  });
});

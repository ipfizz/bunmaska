import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createIpcRenderer } from '../../../src/renderer/api/ipc-renderer';
import { generatePreloadBootstrap } from '../../../src/renderer/preload-bootstrap';

type Bridge = { _dispatch: (raw: string) => void };

let bridge: Bridge;
let posted: string[];

/** Deliver a main-to-renderer `send` through the real bootstrap. */
const dispatch = (channel: string, ...args: unknown[]): void =>
  bridge._dispatch(JSON.stringify({ kind: 'send', channel, args }));

beforeEach(() => {
  posted = [];
  const scope: Record<string, unknown> = {
    webkit: { messageHandlers: { bunmaska: { postMessage: (msg: string) => posted.push(msg) } } },
  };
  new Function('globalThis', generatePreloadBootstrap())(scope);
  bridge = scope['__bunmaska'] as Bridge;
  Reflect.set(globalThis, '__bunmaska', bridge);
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__bunmaska');
});

describe('ipcRenderer.send', () => {
  test('posts a send envelope with the channel and args', () => {
    createIpcRenderer().send('ping', 1, 2);
    expect(posted.map((raw) => JSON.parse(raw))).toEqual([
      { kind: 'send', channel: 'ping', args: [1, 2] },
    ]);
  });
});

describe('ipcRenderer.invoke', () => {
  test('resolves with the reply to its invoke envelope', async () => {
    const result = createIpcRenderer().invoke('compute', 41);
    const env = JSON.parse(posted[0] ?? '');
    expect(env).toMatchObject({ kind: 'invoke', channel: 'compute', args: [41] });
    bridge._dispatch(JSON.stringify({ kind: 'reply', id: env.id, ok: true, result: 42 }));
    expect(await result).toBe(42);
  });
});

describe('ipcRenderer.on', () => {
  test('registers a listener that receives an event object plus args', () => {
    const received: unknown[] = [];
    createIpcRenderer().on('news', (event, ...args) => received.push({ event, args }));
    dispatch('news', 'hello', 7);
    expect(received).toEqual([{ event: {}, args: ['hello', 7] }]);
  });
});

describe('ipcRenderer.once', () => {
  test('registers a listener that fires once with an event object plus args', () => {
    const received: unknown[] = [];
    createIpcRenderer().once('news', (event, ...args) => received.push({ event, args }));
    dispatch('news', 'hello', 7);
    dispatch('news', 'again');
    expect(received).toEqual([{ event: {}, args: ['hello', 7] }]);
  });

  test('firing a once leaves an on listener of the same function removable', () => {
    const ipc = createIpcRenderer();
    let calls = 0;
    const listener = (): void => {
      calls += 1;
    };
    ipc.on('state', listener);
    ipc.once('state', listener);
    dispatch('state');
    ipc.removeListener('state', listener);
    dispatch('state');
    expect(calls).toBe(2);
  });
});

describe('ipcRenderer.removeListener', () => {
  test('removes a previously registered on listener', () => {
    const ipc = createIpcRenderer();
    let calls = 0;
    const listener = (): void => {
      calls += 1;
    };
    ipc.on('news', listener);
    ipc.removeListener('news', listener);
    dispatch('news');
    expect(calls).toBe(0);
  });

  test('removes the right listener and leaves the others', () => {
    const ipc = createIpcRenderer();
    const hits: string[] = [];
    const a = (): void => void hits.push('a');
    const b = (): void => void hits.push('b');
    ipc.on('news', a);
    ipc.on('news', b);
    ipc.removeListener('news', a);
    dispatch('news');
    expect(hits).toEqual(['b']);
  });

  test('removing an unknown listener is a no-op', () => {
    const ipc = createIpcRenderer();
    expect(() => ipc.removeListener('news', () => undefined)).not.toThrow();
  });
});

describe('ipcRenderer.removeAllListeners', () => {
  test('clears a single channel when given one', () => {
    const ipc = createIpcRenderer();
    const hits: string[] = [];
    ipc.on('news', () => void hits.push('news'));
    ipc.on('other', () => void hits.push('other'));
    ipc.removeAllListeners('news');
    dispatch('news');
    dispatch('other');
    expect(hits).toEqual(['other']);
  });

  test('clears every channel when given no argument', () => {
    const ipc = createIpcRenderer();
    const hits: string[] = [];
    ipc.on('a', () => void hits.push('a'));
    ipc.on('b', () => void hits.push('b'));
    ipc.removeAllListeners();
    dispatch('a');
    dispatch('b');
    expect(hits).toEqual([]);
  });
});

describe('ipcRenderer without a bridge', () => {
  test('throws pointing page code at contextBridge when the bridge is absent', () => {
    Reflect.deleteProperty(globalThis, '__bunmaska');
    expect(() => createIpcRenderer().send('x')).toThrow(
      /only available in the preload \(isolated world\).*contextBridge/,
    );
  });
});

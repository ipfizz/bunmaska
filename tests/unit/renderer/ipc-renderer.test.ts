import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createIpcRenderer } from '../../../src/renderer/api/ipc-renderer';

type Listener = (...args: unknown[]) => void;

type FakeBridge = {
  send: (channel: string, ...args: unknown[]) => void;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (channel: string, listener: Listener) => void;
  once: (channel: string, listener: Listener) => void;
  removeListener: (channel: string, listener: Listener) => void;
  removeAllListeners: (channel?: string) => void;
};

type Record = { fn: Listener; once: boolean };

let sent: Array<{ channel: string; args: unknown[] }>;
let invoked: Array<{ channel: string; args: unknown[] }>;
let registered: Map<string, Record[]>;

/** Mirror the real bridge dispatch so once/remove semantics are exercised. */
const dispatch = (channel: string, ...args: unknown[]): void => {
  const live = registered.get(channel) ?? [];
  for (const record of [...live]) {
    const current = registered.get(channel) ?? [];
    if (!current.includes(record)) {
      continue;
    }
    if (record.once) {
      current.splice(current.indexOf(record), 1);
    }
    record.fn(...args);
  }
};

beforeEach(() => {
  sent = [];
  invoked = [];
  registered = new Map();
  const bridge: FakeBridge = {
    send: (channel, ...args) => sent.push({ channel, args }),
    invoke: (channel, ...args) => {
      invoked.push({ channel, args });
      return Promise.resolve(`result:${channel}`);
    },
    on: (channel, listener) => {
      const list = registered.get(channel) ?? [];
      list.push({ fn: listener, once: false });
      registered.set(channel, list);
    },
    once: (channel, listener) => {
      const list = registered.get(channel) ?? [];
      list.push({ fn: listener, once: true });
      registered.set(channel, list);
    },
    removeListener: (channel, listener) => {
      const list = registered.get(channel);
      if (!list) {
        return;
      }
      const index = list.findIndex((r) => r.fn === listener);
      if (index !== -1) {
        list.splice(index, 1);
      }
    },
    removeAllListeners: (channel) => {
      if (channel === undefined) {
        registered.clear();
      } else {
        registered.delete(channel);
      }
    },
  };
  Reflect.set(globalThis, '__bunmaska', bridge);
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__bunmaska');
});

describe('ipcRenderer.send', () => {
  test('forwards channel and args to the bridge', () => {
    createIpcRenderer().send('ping', 1, 2);
    expect(sent).toEqual([{ channel: 'ping', args: [1, 2] }]);
  });
});

describe('ipcRenderer.invoke', () => {
  test('forwards to the bridge and returns its promise', async () => {
    const result = await createIpcRenderer().invoke('compute', 41);
    expect(invoked).toEqual([{ channel: 'compute', args: [41] }]);
    expect(result).toBe('result:compute');
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
  test('throws a clear error if the preload bridge is absent', () => {
    Reflect.deleteProperty(globalThis, '__bunmaska');
    expect(() => createIpcRenderer().send('x')).toThrow(/preload/i);
  });
});

import { describe, expect, test } from 'bun:test';
import { generatePreloadBootstrap } from '../../../src/renderer/preload-bootstrap';

type Listener = (...args: unknown[]) => void;

type Bridge = {
  send: (channel: string, ...args: unknown[]) => void;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (channel: string, listener: Listener) => void;
  once: (channel: string, listener: Listener) => void;
  removeListener: (channel: string, listener: Listener) => void;
  removeAllListeners: (channel?: string) => void;
  _dispatch: (raw: string) => void;
};

const sendEnvelope = (channel: string, args: unknown[] = []): string =>
  JSON.stringify({ kind: 'send', channel, args });

const evalBootstrap = (): { bridge: Bridge; posted: string[] } => {
  const posted: string[] = [];
  const scope: Record<string, unknown> = {};
  scope['webkit'] = {
    messageHandlers: { bunmaska: { postMessage: (msg: string) => posted.push(msg) } },
  };
  const fn = new Function('globalThis', generatePreloadBootstrap());
  fn(scope);
  return { bridge: scope['__bunmaska'] as Bridge, posted };
};

describe('generatePreloadBootstrap output', () => {
  test('returns a non-empty string', () => {
    expect(generatePreloadBootstrap().length).toBeGreaterThan(0);
  });

  test('contains no TypeScript syntax (it ships to a raw JS engine)', () => {
    const src = generatePreloadBootstrap();
    expect(src).not.toMatch(/:\s*(string|number|void|unknown|boolean)\b/);
    expect(src).not.toMatch(/\bas\s+(Record|string|number|unknown)\b/);
  });

  test('installs a __bunmaska object on the global', () => {
    expect(evalBootstrap().bridge).toBeDefined();
  });
});

describe('__bunmaska.send', () => {
  test('posts a send envelope through the message handler', () => {
    const { bridge, posted } = evalBootstrap();
    bridge.send('ping', 1, 'two');
    expect(JSON.parse(posted[0] ?? '')).toEqual({
      kind: 'send',
      channel: 'ping',
      args: [1, 'two'],
    });
  });
});

describe('__bunmaska.invoke', () => {
  test('posts an invoke envelope with a numeric id and returns a promise', () => {
    const { bridge, posted } = evalBootstrap();
    const promise = bridge.invoke('compute', 41);
    expect(promise).toBeInstanceOf(Promise);
    const env = JSON.parse(posted[0] ?? '');
    expect(env.kind).toBe('invoke');
    expect(env.channel).toBe('compute');
    expect(env.args).toEqual([41]);
    expect(typeof env.id).toBe('number');
  });

  test('resolves on a matching ok reply', async () => {
    const { bridge, posted } = evalBootstrap();
    const promise = bridge.invoke('compute', 41);
    const id = JSON.parse(posted[0] ?? '').id as number;
    bridge._dispatch(JSON.stringify({ kind: 'reply', id, ok: true, result: 42 }));
    expect(await promise).toBe(42);
  });

  test('rejects on an error reply', async () => {
    const { bridge, posted } = evalBootstrap();
    const promise = bridge.invoke('compute', 41);
    const id = JSON.parse(posted[0] ?? '').id as number;
    bridge._dispatch(JSON.stringify({ kind: 'reply', id, ok: false, error: 'nope' }));
    await expect(promise).rejects.toThrow('nope');
  });

  test('assigns distinct ids to concurrent invokes', () => {
    const { bridge, posted } = evalBootstrap();
    void bridge.invoke('a');
    void bridge.invoke('b');
    expect(JSON.parse(posted[0] ?? '').id).not.toBe(JSON.parse(posted[1] ?? '').id);
  });
});

describe('__bunmaska.on', () => {
  test('delivers a send envelope from main to a registered listener', () => {
    const { bridge } = evalBootstrap();
    const received: unknown[][] = [];
    bridge.on('news', (...args) => received.push(args));
    bridge._dispatch(JSON.stringify({ kind: 'send', channel: 'news', args: ['hello', 7] }));
    expect(received).toEqual([['hello', 7]]);
  });

  test('ignores send envelopes with no listener', () => {
    const { bridge } = evalBootstrap();
    expect(() =>
      bridge._dispatch(JSON.stringify({ kind: 'send', channel: 'nobody', args: [] })),
    ).not.toThrow();
  });

  test('invokes every registered listener for a channel in order', () => {
    const { bridge } = evalBootstrap();
    const order: number[] = [];
    bridge.on('multi', () => order.push(1));
    bridge.on('multi', () => order.push(2));
    bridge._dispatch(sendEnvelope('multi'));
    expect(order).toEqual([1, 2]);
  });
});

describe('__bunmaska.once', () => {
  test('fires exactly once then auto-removes', () => {
    const { bridge } = evalBootstrap();
    let calls = 0;
    bridge.once('tick', () => {
      calls += 1;
    });
    bridge._dispatch(sendEnvelope('tick'));
    bridge._dispatch(sendEnvelope('tick'));
    expect(calls).toBe(1);
  });

  test('passes the envelope args to the listener', () => {
    const { bridge } = evalBootstrap();
    const received: unknown[][] = [];
    bridge.once('tick', (...args) => received.push(args));
    bridge._dispatch(sendEnvelope('tick', ['a', 2]));
    expect(received).toEqual([['a', 2]]);
  });

  test('a once listener removed before dispatch never fires', () => {
    const { bridge } = evalBootstrap();
    let calls = 0;
    const fn = (): void => {
      calls += 1;
    };
    bridge.once('tick', fn);
    bridge.removeListener('tick', fn);
    bridge._dispatch(sendEnvelope('tick'));
    expect(calls).toBe(0);
  });
});

describe('__bunmaska.removeListener', () => {
  test('removes the specific listener and leaves the others', () => {
    const { bridge } = evalBootstrap();
    const hits: string[] = [];
    const a = (): void => void hits.push('a');
    const b = (): void => void hits.push('b');
    bridge.on('news', a);
    bridge.on('news', b);
    bridge.removeListener('news', a);
    bridge._dispatch(sendEnvelope('news'));
    expect(hits).toEqual(['b']);
  });

  test('a removed listener does not fire on a later dispatch', () => {
    const { bridge } = evalBootstrap();
    let calls = 0;
    const fn = (): void => {
      calls += 1;
    };
    bridge.on('news', fn);
    bridge._dispatch(sendEnvelope('news'));
    bridge.removeListener('news', fn);
    bridge._dispatch(sendEnvelope('news'));
    expect(calls).toBe(1);
  });

  test('removing an unknown listener is a no-op', () => {
    const { bridge } = evalBootstrap();
    expect(() => bridge.removeListener('news', () => undefined)).not.toThrow();
    expect(() => bridge.removeListener('missing', () => undefined)).not.toThrow();
  });

  test('removes only the first matching instance of a duplicated listener', () => {
    const { bridge } = evalBootstrap();
    let calls = 0;
    const fn = (): void => {
      calls += 1;
    };
    bridge.on('dup', fn);
    bridge.on('dup', fn);
    bridge.removeListener('dup', fn);
    bridge._dispatch(sendEnvelope('dup'));
    expect(calls).toBe(1);
  });
});

describe('__bunmaska.removeAllListeners', () => {
  test('clears a single channel when given one', () => {
    const { bridge } = evalBootstrap();
    const hits: string[] = [];
    bridge.on('news', () => void hits.push('news'));
    bridge.on('other', () => void hits.push('other'));
    bridge.removeAllListeners('news');
    bridge._dispatch(sendEnvelope('news'));
    bridge._dispatch(sendEnvelope('other'));
    expect(hits).toEqual(['other']);
  });

  test('clears every channel when given no argument', () => {
    const { bridge } = evalBootstrap();
    const hits: string[] = [];
    bridge.on('a', () => void hits.push('a'));
    bridge.on('b', () => void hits.push('b'));
    bridge.removeAllListeners();
    bridge._dispatch(sendEnvelope('a'));
    bridge._dispatch(sendEnvelope('b'));
    expect(hits).toEqual([]);
  });

  test('clearing an unknown channel is a no-op', () => {
    const { bridge } = evalBootstrap();
    expect(() => bridge.removeAllListeners('missing')).not.toThrow();
  });
});

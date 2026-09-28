import { describe, expect, test } from 'bun:test';
import {
  type ContextBridgeTransport,
  createContextBridge,
} from '../../../src/renderer/api/context-bridge';
import {
  CHANNEL_GLOBAL_KEY,
  type CustomEventCtor,
  type EventScope,
  generatePageWorldStub,
  installCrossWorldHost,
  replyChannel,
} from '../../../src/renderer/api/cross-world-bridge';

/** One mock `document` is the channel both worlds share; the page world only sees cloned values. */

/** A minimal shared event bus standing in for `document`. */
class MockDocument implements EventScope {
  readonly #listeners = new Map<string, Array<(e: { detail?: unknown }) => void>>();

  addEventListener(type: string, listener: (e: { detail?: unknown }) => void): void {
    const list = this.#listeners.get(type) ?? [];
    list.push(listener);
    this.#listeners.set(type, list);
  }

  dispatchEvent(event: { type: string; detail?: unknown }): boolean {
    for (const listener of this.#listeners.get(event.type) ?? []) {
      listener({ detail: event.detail });
    }
    return true;
  }
}

/** A CustomEvent shim carrying type + detail. */
const MockCustomEvent: CustomEventCtor = class {
  readonly type: string;
  readonly detail?: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
};

const CHANNEL = '__test_channel';

/** A page world: the `window`-like global plus a typed read of `window[key]`. */
type PageWorld = {
  /** Read a materialised surface off the page `window` (avoids index-signature access). */
  read<T>(key: string): T;
};

/** A fresh `window`-like global running the page stub over the shared mock document. */
const makePageWorld = (
  doc: MockDocument,
  channel: string = CHANNEL,
  setTimeoutImpl: (fn: () => void) => unknown = setTimeout,
): PageWorld => {
  const win: Record<string, unknown> = {};
  const factory = new Function(
    'window',
    'document',
    'CustomEvent',
    'Map',
    'Promise',
    'Object',
    'Array',
    'setTimeout',
    generatePageWorldStub(channel),
  );
  factory(win, doc, MockCustomEvent, Map, Promise, Object, Array, setTimeoutImpl);
  return { read: <T>(key: string): T => win[key] as T };
};

const makeIsolatedHost = (doc: MockDocument) =>
  installCrossWorldHost(CHANNEL, doc, MockCustomEvent);

const transport = (doc: MockDocument): ContextBridgeTransport => ({
  channelId: CHANNEL,
  scope: doc,
  CustomEventImpl: MockCustomEvent,
});

describe('contextBridge.exposeInMainWorld (cross-world)', () => {
  test('throws when no cross-world channel is available', () => {
    expect(() => createContextBridge().exposeInMainWorld('x', { a: 1 })).toThrow(/channel/i);
  });

  test('throws if the key is already exposed', () => {
    const doc = new MockDocument();
    const bridge = createContextBridge(transport(doc));
    bridge.exposeInMainWorld('api', { a: () => 1 });
    expect(() => bridge.exposeInMainWorld('api', { b: () => 2 })).toThrow(/already/i);
  });

  test('shares the injected host, so a key exposed through both paths collides', () => {
    const doc = new MockDocument();
    const globals = {
      __bunmaska: { exposeInMainWorld: makeIsolatedHost(doc) },
      [CHANNEL_GLOBAL_KEY]: CHANNEL,
      document: doc,
      CustomEvent: MockCustomEvent,
    };
    const saved = Object.keys(globals).map((name) => [name, Reflect.get(globalThis, name)]);
    Object.assign(globalThis, globals);
    try {
      globals.__bunmaska.exposeInMainWorld('api', { a: () => 1 });
      expect(() => createContextBridge().exposeInMainWorld('api', { b: () => 2 })).toThrow(
        /already/i,
      );
    } finally {
      for (const [name, value] of saved) {
        Reflect.set(globalThis, name as string, value);
      }
    }
  });

  test('page method resolves to the isolated handler return value', async () => {
    const doc = new MockDocument();
    const page = makePageWorld(doc);
    createContextBridge(transport(doc)).exposeInMainWorld('myApi', {
      add: (a: number, b: number) => a + b,
    });
    const api = page.read<{ add: (a: number, b: number) => Promise<number> }>('myApi');
    expect(api).toBeDefined();
    await expect(api.add(20, 22)).resolves.toBe(42);
  });

  test('async (Promise-returning) handlers are awaited and resolved', async () => {
    const doc = new MockDocument();
    const page = makePageWorld(doc);
    createContextBridge(transport(doc)).exposeInMainWorld('myApi', {
      later: () => Promise.resolve('done'),
    });
    const api = page.read<{ later: () => Promise<string> }>('myApi');
    await expect(api.later()).resolves.toBe('done');
  });

  test('a throwing handler rejects the page-side promise with its message', async () => {
    const doc = new MockDocument();
    const page = makePageWorld(doc);
    createContextBridge(transport(doc)).exposeInMainWorld('myApi', {
      boom: () => {
        throw new Error('kaboom');
      },
    });
    const api = page.read<{ boom: () => Promise<never> }>('myApi');
    await expect(api.boom()).rejects.toThrow('kaboom');
  });

  test('non-function values are deep-cloned + frozen into the page object', () => {
    const doc = new MockDocument();
    const page = makePageWorld(doc);
    const source = { nested: { n: 1 } };
    createContextBridge(transport(doc)).exposeInMainWorld('myApi', { data: source, version: 3 });
    const api = page.read<{ data: { nested: { n: number } }; version: number }>('myApi');
    expect(api.version).toBe(3);
    expect(api.data).toEqual({ nested: { n: 1 } });
    // Cloned, not the same reference (no live object refs cross the boundary).
    expect(api.data).not.toBe(source);
  });

  test('the page object is frozen (tamper-resistant)', () => {
    const doc = new MockDocument();
    const page = makePageWorld(doc);
    createContextBridge(transport(doc)).exposeInMainWorld('myApi', { ping: () => 'pong' });
    expect(Object.isFrozen(page.read('myApi'))).toBe(true);
  });

  test('the page world never holds a reference to the real handler', () => {
    const doc = new MockDocument();
    const page = makePageWorld(doc);
    const realHandler = (): string => 'secret';
    createContextBridge(transport(doc)).exposeInMainWorld('myApi', { ping: realHandler });
    const api = page.read<{ ping: unknown }>('myApi');
    // The page-side method is a generated proxy, NOT the real function.
    expect(api.ping).not.toBe(realHandler);
    expect(typeof api.ping).toBe('function');
  });
});

describe('cross-world calls', () => {
  test('a handler slower than any page-side timer still resolves the page promise', async () => {
    const doc = new MockDocument();
    const timers: Array<() => void> = [];
    const page = makePageWorld(doc, CHANNEL, (fn) => timers.push(fn));
    let finish: (value: string) => void = () => undefined;
    createContextBridge(transport(doc)).exposeInMainWorld('api', {
      save: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    });
    const call = page.read<{ save: () => Promise<string> }>('api').save();
    await Bun.sleep(0);
    for (const fire of timers.splice(0)) {
      fire();
    }
    finish('saved');
    await expect(call).resolves.toBe('saved');
  });

  test('a non-cloneable argument rejects at once, naming the call', async () => {
    const doc = new MockDocument();
    const page = makePageWorld(doc);
    createContextBridge(transport(doc)).exposeInMainWorld('api', { on: () => 'registered' });
    const api = page.read<{ on: (callback: () => void) => Promise<string> }>('api');
    await expect(api.on(() => undefined)).rejects.toThrow(/api\.on.*cloneable/);
  });
});

describe('resilient host<->page handshake (both orderings)', () => {
  const flush = (): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, 5);
    });

  test('host installed BEFORE the page stub: surface still materialises', async () => {
    const doc = new MockDocument();
    const expose = makeIsolatedHost(doc);
    expose('myApi', { add: (a: number, b: number) => a + b, version: 9 });
    // Page stub attaches its listeners AFTER the host already announced once.
    const page = makePageWorld(doc);
    await flush();
    const api = page.read<{ add: (a: number, b: number) => Promise<number>; version: number }>(
      'myApi',
    );
    expect(api).toBeDefined();
    expect(api.version).toBe(9);
    await expect(api.add(20, 22)).resolves.toBe(42);
  });

  test('page stub installed BEFORE the host: surface still materialises', async () => {
    const doc = new MockDocument();
    // Page stub attaches first (and emits ready); the host arrives later.
    const page = makePageWorld(doc);
    const expose = makeIsolatedHost(doc);
    expose('myApi', { add: (a: number, b: number) => a + b, version: 11 });
    await flush();
    const api = page.read<{ add: (a: number, b: number) => Promise<number>; version: number }>(
      'myApi',
    );
    expect(api).toBeDefined();
    expect(api.version).toBe(11);
    await expect(api.add(1, 2)).resolves.toBe(3);
  });
});

describe('page object hardening', () => {
  test('nested cloned objects are deep-frozen', () => {
    const doc = new MockDocument();
    const page = makePageWorld(doc);
    createContextBridge(transport(doc)).exposeInMainWorld('myApi', {
      data: { nested: { n: 1 } },
    });
    const api = page.read<{ data: { nested: { n: number } } }>('myApi');
    expect(Object.isFrozen(api.data)).toBe(true);
    expect(Object.isFrozen(api.data.nested)).toBe(true);
  });

  test('a typed-array value materialises intact', () => {
    const doc = new MockDocument();
    const page = makePageWorld(doc);
    createContextBridge(transport(doc)).exposeInMainWorld('myApi', {
      bytes: new Uint8Array([1, 2]),
    });
    expect(page.read<{ bytes: Uint8Array }>('myApi').bytes).toEqual(new Uint8Array([1, 2]));
  });

  test('a cyclic value materialises with its cycle', () => {
    const doc = new MockDocument();
    const page = makePageWorld(doc);
    const tree: { name: string; self?: unknown } = { name: 'root' };
    tree.self = tree;
    createContextBridge(transport(doc)).exposeInMainWorld('myApi', { tree });
    const copy = page.read<{ tree: { self: unknown } }>('myApi').tree;
    expect(copy.self).toBe(copy);
    expect(Object.isFrozen(copy)).toBe(true);
  });

  test('the materialised target has a null prototype (no __proto__ trap)', () => {
    const doc = new MockDocument();
    const page = makePageWorld(doc);
    createContextBridge(transport(doc)).exposeInMainWorld('myApi', { ping: () => 'pong' });
    expect(Object.getPrototypeOf(page.read('myApi'))).toBe(null);
  });

  test('a forged call to an inherited, unannounced method is refused', async () => {
    const doc = new MockDocument();
    const api = Object.assign(Object.create({ secret: () => 'SECRET' }), { ping: () => 'pong' });
    makeIsolatedHost(doc)('api', api);
    const replies: unknown[] = [];
    doc.addEventListener(replyChannel(CHANNEL), (e) => replies.push(e.detail));
    doc.dispatchEvent({ type: CHANNEL, detail: { callId: 99, key: 'api', method: 'secret' } });
    await Bun.sleep(0);
    expect(replies).toEqual([
      { callId: 99, ok: false, error: 'contextBridge: no method "secret"' },
    ]);
  });

  test('a non-object api is rejected at expose time', () => {
    const expose = makeIsolatedHost(new MockDocument());
    for (const api of [false, '1.2', () => 5, [1, 2], null]) {
      expect(() => expose('api', api as unknown as Record<string, unknown>)).toThrow(
        /must be an object/,
      );
    }
  });

  test('a nested function is rejected at expose time, naming the member', () => {
    const expose = makeIsolatedHost(new MockDocument());
    expect(() => expose('api', { ipc: { send: () => undefined } })).toThrow(
      /"ipc".*nested functions are not supported/,
    );
  });

  test('a prototype-pollution member name is rejected at expose time', () => {
    const doc = new MockDocument();
    const expose = makeIsolatedHost(doc);
    expect(() => expose('myApi', { constructor: () => 1 })).toThrow(/not allowed/i);
    expect(() => expose('other', { prototype: 1 })).toThrow(/not allowed/i);
  });
});

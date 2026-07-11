import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ipcMain } from '../../../../src/main/api/ipc-main';
import { resetWebContentsIdsForTesting, WebContents } from '../../../../src/main/api/web-contents';
import { decodeEnvelope, encodeEnvelope } from '../../../../src/main/ipc/ipc-protocol';
import type {
  NativeNavigationEvent,
  NativeWebContents,
} from '../../../../src/main/platform/native';

const makeFakeNative = (): {
  native: NativeWebContents;
  sent: string[];
  execs: string[];
  zooms: number[];
  userAgents: string[];
  fireRenderer: (json: string) => void;
  fireNavigation: (event: NativeNavigationEvent) => void;
  fireWindowOpen: (url: string) => void;
} => {
  const sent: string[] = [];
  const execs: string[] = [];
  const zooms: number[] = [];
  const userAgents: string[] = [];
  let onEnvelope: ((json: string) => void) | undefined;
  let onNav: ((event: NativeNavigationEvent) => void) | undefined;
  let onWindowOpen: ((url: string) => void) | undefined;
  const native: NativeWebContents = {
    loadURL: () => undefined,
    loadHTML: () => undefined,
    getURL: () => '',
    getTitle: () => 'Fake Title',
    reload: () => undefined,
    reloadIgnoringCache: () => undefined,
    stop: () => undefined,
    goBack: () => undefined,
    goForward: () => undefined,
    canGoBack: () => false,
    canGoForward: () => false,
    executeJavaScript: (code) => {
      execs.push(code);
      return Promise.resolve(undefined);
    },
    printToPDF: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    capturePage: () => Promise.resolve(new Uint8Array(0)),
    openDevTools: () => undefined,
    closeDevTools: () => undefined,
    setZoomFactor: (factor) => zooms.push(factor),
    setUserAgent: (ua) => userAgents.push(ua),
    sendEnvelopeToRenderer: (json) => sent.push(json),
    onRendererEnvelope: (cb) => {
      onEnvelope = cb;
    },
    onNavigation: (cb) => {
      onNav = cb;
    },
    setWindowOpenHandler: (cb) => {
      onWindowOpen = cb;
    },
    sendInputEvent: () => undefined,
  };
  return {
    native,
    sent,
    execs,
    zooms,
    userAgents,
    fireRenderer: (json) => onEnvelope?.(json),
    fireNavigation: (event) => onNav?.(event),
    fireWindowOpen: (url) => onWindowOpen?.(url),
  };
};

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const reset = (): void => {
  resetWebContentsIdsForTesting();
  ipcMain.removeAllListeners();
  ipcMain.removeHandler('add');
  ipcMain.removeHandler('boom');
};

beforeEach(reset);
afterEach(reset);

describe('WebContents.loadFile', () => {
  test('percent-encodes spaces and reserved characters in the file url', () => {
    const loaded: string[] = [];
    const { native } = makeFakeNative();
    const wc = new WebContents({ ...native, loadURL: (url: string) => loaded.push(url) });
    const path =
      process.platform === 'win32' ? 'C:\\My Apps\\page #1.html' : '/my apps/page #1.html';
    wc.loadFile(path);
    expect(loaded).toHaveLength(1);
    const url = loaded[0] as string;
    expect(url.startsWith('file://')).toBe(true);
    expect(url).toContain('page%20%231.html');
    expect(url).not.toContain(' ');
    expect(url).not.toContain('#');
  });

  test('appends hash and query options (Electron parity for hash-routed SPAs)', () => {
    const loaded: string[] = [];
    const { native } = makeFakeNative();
    const wc = new WebContents({ ...native, loadURL: (url: string) => loaded.push(url) });
    const path = process.platform === 'win32' ? 'C:\\app\\index.html' : '/app/index.html';
    wc.loadFile(path, { hash: '/settings', query: { tab: 'a b' } });
    const url = loaded[0] as string;
    expect(url).toContain('index.html');
    expect(url).toContain('?tab=a+b');
    expect(url.endsWith('#/settings')).toBe(true);
  });
});

describe('WebContents.sendInputEvent (validation before FFI)', () => {
  test('throws on an unrecognized event type instead of silently no-op', () => {
    const calls: unknown[] = [];
    const { native } = makeFakeNative();
    const wc = new WebContents({ ...native, sendInputEvent: (e) => calls.push(e) });
    expect(() => wc.sendInputEvent({ type: 'mousedown', x: 1, y: 1 } as never)).toThrow(/invalid/i);
    expect(() => wc.sendInputEvent({ type: 'mouseWheel', x: 1, y: 1 } as never)).toThrow(
      /invalid/i,
    );
    expect(calls).toHaveLength(0);
  });

  test('throws on non-finite mouse coordinates (no trusted click at 0,0)', () => {
    const calls: unknown[] = [];
    const { native } = makeFakeNative();
    const wc = new WebContents({ ...native, sendInputEvent: (e) => calls.push(e) });
    expect(() => wc.sendInputEvent({ type: 'mouseDown', x: Number.NaN, y: 10 })).toThrow(/finite/i);
    expect(() => wc.sendInputEvent({ type: 'mouseMove', x: 1, y: undefined as never })).toThrow(
      /finite/i,
    );
    expect(calls).toHaveLength(0);
  });

  test('throws on an empty keyboard keyCode', () => {
    const calls: unknown[] = [];
    const { native } = makeFakeNative();
    const wc = new WebContents({ ...native, sendInputEvent: (e) => calls.push(e) });
    expect(() => wc.sendInputEvent({ type: 'char', keyCode: '' })).toThrow(/keyCode/i);
    expect(calls).toHaveLength(0);
  });

  test('forwards a valid event to the native layer', () => {
    const calls: unknown[] = [];
    const { native } = makeFakeNative();
    const wc = new WebContents({ ...native, sendInputEvent: (e) => calls.push(e) });
    wc.sendInputEvent({ type: 'mouseDown', x: 3, y: 4, button: 'left' });
    wc.sendInputEvent({ type: 'char', keyCode: 'a' });
    expect(calls).toHaveLength(2);
  });
});

describe('WebContents.insertCSS / removeInsertedCSS', () => {
  test('insertCSS injects the css and resolves to a key', async () => {
    const { native, execs } = makeFakeNative();
    const key = await new WebContents(native).insertCSS('body { color: red; }');
    expect(typeof key).toBe('string');
    expect(execs).toHaveLength(1);
    expect(execs[0]).toContain('body { color: red; }');
    expect(execs[0]).toContain(key);
  });

  test('insertCSS returns a distinct key per call', async () => {
    const { native } = makeFakeNative();
    const wc = new WebContents(native);
    const a = await wc.insertCSS('a {}');
    const b = await wc.insertCSS('b {}');
    expect(a).not.toBe(b);
  });

  test('removeInsertedCSS runs a script referencing the key', async () => {
    const { native, execs } = makeFakeNative();
    const wc = new WebContents(native);
    const key = await wc.insertCSS('a {}');
    await wc.removeInsertedCSS(key);
    expect(execs).toHaveLength(2);
    expect(execs[1]).toContain(key);
    expect(execs[1]).toContain('remove');
  });
});

describe('WebContents.setZoomFactor / getZoomFactor', () => {
  test('defaults to 1', () => {
    expect(new WebContents(makeFakeNative().native).getZoomFactor()).toBe(1);
  });

  test('setZoomFactor applies natively and updates getZoomFactor', () => {
    const { native, zooms } = makeFakeNative();
    const wc = new WebContents(native);
    wc.setZoomFactor(1.5);
    expect(zooms).toEqual([1.5]);
    expect(wc.getZoomFactor()).toBe(1.5);
  });

  test('setZoomLevel applies factor 1.2**level; getZoomLevel inverts it', () => {
    const { native, zooms } = makeFakeNative();
    const wc = new WebContents(native);
    wc.setZoomLevel(1);
    expect(zooms[zooms.length - 1]).toBeCloseTo(1.2);
    expect(wc.getZoomFactor()).toBeCloseTo(1.2);
    expect(wc.getZoomLevel()).toBeCloseTo(1);
    wc.setZoomLevel(0);
    expect(wc.getZoomLevel()).toBeCloseTo(0);
  });
});

describe('WebContents.getTitle / isLoading / stop', () => {
  test('getTitle delegates to the native title', () => {
    expect(new WebContents(makeFakeNative().native).getTitle()).toBe('Fake Title');
  });

  test('isLoading tracks did-start-loading → did-finish-load', () => {
    const { native, fireNavigation } = makeFakeNative();
    const wc = new WebContents(native);
    expect(wc.isLoading()).toBe(false);
    fireNavigation({ type: 'did-start-loading' });
    expect(wc.isLoading()).toBe(true);
    fireNavigation({ type: 'did-finish-load' });
    expect(wc.isLoading()).toBe(false);
  });

  test('stop and reloadIgnoringCache do not throw', () => {
    const wc = new WebContents(makeFakeNative().native);
    expect(() => {
      wc.stop();
      wc.reloadIgnoringCache();
    }).not.toThrow();
  });
});

describe('WebContents.printToPDF', () => {
  test('resolves the native PDF bytes as a Buffer', async () => {
    const wc = new WebContents(makeFakeNative().native);
    const pdf = await wc.printToPDF();
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect([...pdf]).toEqual([1, 2, 3]);
  });
});

describe('WebContents.capturePage', () => {
  test('resolves a NativeImage from the native PNG bytes', async () => {
    const wc = new WebContents(makeFakeNative().native);
    const image = await wc.capturePage();
    expect(typeof image.toPNG).toBe('function');
    expect(typeof image.isEmpty).toBe('function');
  });
});

describe('WebContents.devtools + isDestroyed', () => {
  test('toggleDevTools opens then closes; isDevToolsOpened tracks it', () => {
    const wc = new WebContents(makeFakeNative().native);
    expect(wc.isDevToolsOpened()).toBe(false);
    wc.toggleDevTools();
    expect(wc.isDevToolsOpened()).toBe(true);
    wc.toggleDevTools();
    expect(wc.isDevToolsOpened()).toBe(false);
  });

  test('isDestroyed flips after markDestroyed', () => {
    const wc = new WebContents(makeFakeNative().native);
    expect(wc.isDestroyed()).toBe(false);
    wc.markDestroyed();
    expect(wc.isDestroyed()).toBe(true);
  });
});

describe('WebContents.setUserAgent / getUserAgent', () => {
  test('defaults to an empty override', () => {
    expect(new WebContents(makeFakeNative().native).getUserAgent()).toBe('');
  });

  test('setUserAgent applies natively and updates getUserAgent', () => {
    const { native, userAgents } = makeFakeNative();
    const wc = new WebContents(native);
    wc.setUserAgent('Bunmaska/1.0 (test)');
    expect(userAgents).toEqual(['Bunmaska/1.0 (test)']);
    expect(wc.getUserAgent()).toBe('Bunmaska/1.0 (test)');
  });
});

describe('WebContents.send', () => {
  test('sends a send envelope to the renderer', () => {
    const { native, sent } = makeFakeNative();
    new WebContents(native).send('news', 'hi', 1);
    expect(decodeEnvelope(sent[0] ?? '')).toEqual({
      kind: 'send',
      channel: 'news',
      args: ['hi', 1],
    });
  });
});

describe('WebContents <-> ipcMain auto-wiring', () => {
  test('a renderer send envelope reaches an ipcMain listener with sender set', async () => {
    const { native, fireRenderer } = makeFakeNative();
    const wc = new WebContents(native);
    const calls: Array<{ sender: unknown; args: readonly unknown[] }> = [];
    ipcMain.on('greet', (event, ...args) => calls.push({ sender: event.sender, args }));

    fireRenderer(encodeEnvelope({ kind: 'send', channel: 'greet', args: ['yo'] }));
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(['yo']);
    expect(calls[0]?.sender).toBe(wc);
  });

  test('a renderer invoke is handled and a reply is sent back', async () => {
    const { native, sent, fireRenderer } = makeFakeNative();
    new WebContents(native);
    ipcMain.handle('add', (_event, a, b) => (a as number) + (b as number));

    fireRenderer(encodeEnvelope({ kind: 'invoke', id: 99, channel: 'add', args: [2, 3] }));
    await flush();

    expect(sent).toHaveLength(1);
    expect(decodeEnvelope(sent[0] ?? '')).toEqual({ kind: 'reply', id: 99, ok: true, result: 5 });
  });

  test('a throwing handler sends an error reply', async () => {
    const { native, sent, fireRenderer } = makeFakeNative();
    new WebContents(native);
    ipcMain.handle('boom', () => {
      throw new Error('nope');
    });

    fireRenderer(encodeEnvelope({ kind: 'invoke', id: 1, channel: 'boom', args: [] }));
    await flush();

    expect(decodeEnvelope(sent[0] ?? '')).toEqual({
      kind: 'reply',
      id: 1,
      ok: false,
      error: 'nope',
    });
  });

  test('a malformed renderer envelope is dropped without throwing', async () => {
    const { native, sent, fireRenderer } = makeFakeNative();
    new WebContents(native);
    expect(() => fireRenderer('not json{')).not.toThrow();
    await flush();
    expect(sent).toHaveLength(0);
  });
});

describe('WebContents navigation events', () => {
  test('re-emits did-start-loading, did-finish-load, did-stop-loading', () => {
    const { native, fireNavigation } = makeFakeNative();
    const wc = new WebContents(native);
    const seen: string[] = [];
    for (const type of ['did-start-loading', 'did-finish-load', 'did-stop-loading'] as const) {
      wc.on(type, () => seen.push(type));
    }
    fireNavigation({ type: 'did-start-loading' });
    fireNavigation({ type: 'did-finish-load' });
    fireNavigation({ type: 'did-stop-loading' });
    expect(seen).toEqual(['did-start-loading', 'did-finish-load', 'did-stop-loading']);
  });

  test('did-navigate carries the current URL', () => {
    const { native, fireNavigation } = makeFakeNative();
    const wc = new WebContents({ ...native, getURL: () => 'https://app.test/route' });
    let url: string | undefined;
    wc.on('did-navigate', (_event: unknown, navUrl: string) => {
      url = navUrl;
    });
    fireNavigation({ type: 'did-navigate' });
    expect(url).toBe('https://app.test/route');
  });

  test('re-emits dom-ready', () => {
    const { native, fireNavigation } = makeFakeNative();
    const wc = new WebContents(native);
    let fired = 0;
    wc.on('dom-ready', () => {
      fired += 1;
    });
    fireNavigation({ type: 'dom-ready' });
    expect(fired).toBe(1);
  });

  test('dom-ready fires only from the native event, not on did-navigate', () => {
    const { native, fireNavigation } = makeFakeNative();
    const wc = new WebContents(native);
    let fired = 0;
    wc.on('dom-ready', () => {
      fired += 1;
    });
    fireNavigation({ type: 'did-navigate' });
    expect(fired).toBe(0);
    fireNavigation({ type: 'dom-ready' });
    expect(fired).toBe(1);
  });

  test('did-fail-load carries the error code and description', () => {
    const { native, fireNavigation } = makeFakeNative();
    const wc = new WebContents(native);
    let captured: { code: number; desc: string } | undefined;
    wc.on('did-fail-load', (_event: unknown, code: number, desc: string) => {
      captured = { code, desc };
    });
    fireNavigation({ type: 'did-fail-load', errorCode: -105, errorDescription: 'NOT_FOUND' });
    expect(captured).toEqual({ code: -105, desc: 'NOT_FOUND' });
  });
});

describe('WebContents.setWindowOpenHandler', () => {
  test('invokes the handler with the requested url', () => {
    const { native, fireWindowOpen } = makeFakeNative();
    const wc = new WebContents(native);
    let seen: string | undefined;
    wc.setWindowOpenHandler(({ url }) => {
      seen = url;
      return { action: 'deny' };
    });
    fireWindowOpen('https://popup.test/path');
    expect(seen).toBe('https://popup.test/path');
  });
});

describe('WebContents.openDevTools', () => {
  test('delegates to the native view', () => {
    let opened = 0;
    const { native } = makeFakeNative();
    const wc = new WebContents({
      ...native,
      openDevTools: () => {
        opened += 1;
      },
    });
    wc.openDevTools();
    expect(opened).toBe(1);
  });
});

describe('WebContents.executeJavaScript', () => {
  test('returns the native eval Promise resolving to the script result', async () => {
    const { native } = makeFakeNative();
    const wc = new WebContents({
      ...native,
      executeJavaScript: (code) => Promise.resolve(`evaluated:${code}`),
    });
    const promise = wc.executeJavaScript('1 + 1');
    expect(promise).toBeInstanceOf(Promise);
    expect(await promise).toBe('evaluated:1 + 1');
  });

  test('propagates a native eval rejection', async () => {
    const { native } = makeFakeNative();
    const wc = new WebContents({
      ...native,
      executeJavaScript: () => Promise.reject(new Error('boom')),
    });
    await expect(wc.executeJavaScript('throw 1')).rejects.toThrow('boom');
  });
});

describe('WebContents navigation', () => {
  test('delegates reload, goBack and goForward to the native view', () => {
    const calls: string[] = [];
    const native: NativeWebContents = {
      loadURL: () => undefined,
      loadHTML: () => undefined,
      getURL: () => '',
      getTitle: () => '',
      reload: () => calls.push('reload'),
      reloadIgnoringCache: () => calls.push('reloadIgnoringCache'),
      stop: () => calls.push('stop'),
      goBack: () => calls.push('goBack'),
      goForward: () => calls.push('goForward'),
      canGoBack: () => true,
      canGoForward: () => false,
      executeJavaScript: () => Promise.resolve(undefined),
      printToPDF: () => Promise.resolve(new Uint8Array(0)),
      capturePage: () => Promise.resolve(new Uint8Array(0)),
      openDevTools: () => undefined,
      closeDevTools: () => undefined,
      setZoomFactor: () => undefined,
      setUserAgent: () => undefined,
      sendEnvelopeToRenderer: () => undefined,
      onRendererEnvelope: () => undefined,
      onNavigation: () => undefined,
      setWindowOpenHandler: () => undefined,
      sendInputEvent: () => undefined,
    };
    const wc = new WebContents(native);
    wc.reload();
    wc.goBack();
    wc.goForward();
    expect(calls).toEqual(['reload', 'goBack', 'goForward']);
    expect(wc.canGoBack()).toBe(true);
    expect(wc.canGoForward()).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvalidArgumentError } from '../../../../src/common/errors';
import { resetBootstrapForTesting } from '../../../../src/main/bootstrap';
import { setNativeAppForTesting } from '../../../../src/main/native-app';
import type {
  NativeApplication,
  NativeWebContents,
  NativeWindow,
  NativeWindowOptions,
  Rect,
} from '../../../../src/main/platform/native';
import {
  BrowserWindow,
  resetWindowRegistryForTesting,
} from '../../../../src/main/api/browser-window';
import { resetWebContentsIdsForTesting } from '../../../../src/main/api/web-contents';

type FakeWindow = NativeWindow & { fireClosed: () => void };

const makeFakeWindow = (options: NativeWindowOptions): FakeWindow => {
  let title = options.title;
  let visible = options.show;
  let bounds: Rect = { x: 0, y: 0, width: options.width, height: options.height };
  let maximized = false;
  let minimized = false;
  let onClosed: (() => void) | undefined;
  const webContents: NativeWebContents = {
    loadURL: () => undefined,
    loadHTML: () => undefined,
    getURL: () => 'about:blank',
    reload: () => undefined,
    goBack: () => undefined,
    goForward: () => undefined,
    canGoBack: () => false,
    canGoForward: () => false,
    executeJavaScript: () => undefined,
    openDevTools: () => undefined,
    sendEnvelopeToRenderer: () => undefined,
    onRendererEnvelope: () => undefined,
    onDidFinishLoad: () => undefined,
  };
  return {
    webContents,
    setTitle: (t) => {
      title = t;
    },
    getTitle: () => title,
    setSize: (w, h) => {
      bounds = { ...bounds, width: w, height: h };
    },
    getBounds: () => bounds,
    show: () => {
      visible = true;
    },
    hide: () => {
      visible = false;
    },
    isVisible: () => visible,
    focus: () => {
      visible = true;
    },
    minimize: () => {
      minimized = true;
    },
    maximize: () => {
      maximized = true;
    },
    unmaximize: () => {
      maximized = false;
    },
    isMaximized: () => maximized,
    isMinimized: () => minimized,
    close: () => onClosed?.(),
    onClosed: (cb) => {
      onClosed = cb;
    },
    fireClosed: () => onClosed?.(),
  };
};

const makeFakeApp = (): { native: NativeApplication; created: NativeWindowOptions[] } => {
  const created: NativeWindowOptions[] = [];
  const native: NativeApplication = {
    start: () => undefined,
    onReady: (cb) => cb(),
    quit: () => undefined,
    createWindow: (options) => {
      created.push(options);
      return makeFakeWindow(options);
    },
  };
  return { native, created };
};

let created: NativeWindowOptions[];

beforeEach(() => {
  resetWindowRegistryForTesting();
  resetWebContentsIdsForTesting();
  resetBootstrapForTesting();
  const fake = makeFakeApp();
  created = fake.created;
  setNativeAppForTesting(fake.native);
});

afterEach(() => {
  setNativeAppForTesting(undefined);
});

describe('BrowserWindow construction', () => {
  test('applies default options when none are given', () => {
    new BrowserWindow();
    expect(created[0]).toEqual({ width: 800, height: 600, title: 'Sambar', show: true });
  });

  test('passes through provided options', () => {
    new BrowserWindow({ width: 1024, height: 768, title: 'My App', show: false });
    expect(created[0]).toEqual({ width: 1024, height: 768, title: 'My App', show: false });
  });

  test('assigns incrementing ids', () => {
    const a = new BrowserWindow();
    const b = new BrowserWindow();
    expect(b.id).toBe(a.id + 1);
  });

  test('exposes a WebContents instance', () => {
    const win = new BrowserWindow();
    expect(win.webContents).toBeDefined();
    expect(typeof win.webContents.loadURL).toBe('function');
  });

  test('is a Node EventEmitter', () => {
    expect(typeof new BrowserWindow().on).toBe('function');
  });

  test('leaves preloadScript undefined when webPreferences is omitted', () => {
    new BrowserWindow();
    expect(created[0]?.preloadScript).toBeUndefined();
  });
});

describe('BrowserWindow webPreferences.preload', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sambar-preload-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('reads the preload file and passes its contents as preloadScript', () => {
    const source = 'window.__sambarPreloadRan = true;\n';
    const preloadPath = join(dir, 'preload.js');
    writeFileSync(preloadPath, source);

    new BrowserWindow({ webPreferences: { preload: preloadPath } });

    expect(created[0]?.preloadScript).toBe(source);
  });

  test('resolves a relative preload path against the current working directory', () => {
    const source = 'void 0;\n';
    const preloadPath = join(dir, 'relative-preload.js');
    writeFileSync(preloadPath, source);
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      new BrowserWindow({ webPreferences: { preload: 'relative-preload.js' } });
    } finally {
      process.chdir(cwd);
    }

    expect(created[0]?.preloadScript).toBe(source);
  });

  test('throws InvalidArgumentError naming the path when the preload is missing', () => {
    const missing = join(dir, 'does-not-exist.js');
    expect(() => new BrowserWindow({ webPreferences: { preload: missing } })).toThrow(
      InvalidArgumentError,
    );
    expect(() => new BrowserWindow({ webPreferences: { preload: missing } })).toThrow(missing);
  });
});

describe('BrowserWindow registry', () => {
  test('getAllWindows returns open windows in creation order', () => {
    const a = new BrowserWindow();
    const b = new BrowserWindow();
    expect(BrowserWindow.getAllWindows().map((w) => w.id)).toEqual([a.id, b.id]);
  });

  test('fromId returns the matching window', () => {
    const a = new BrowserWindow();
    expect(BrowserWindow.fromId(a.id)).toBe(a);
  });

  test('fromId returns undefined for an unknown id', () => {
    expect(BrowserWindow.fromId(9999)).toBeUndefined();
  });
});

describe('BrowserWindow lifecycle', () => {
  test('title getter reflects setter', () => {
    const win = new BrowserWindow({ title: 'initial' });
    win.setTitle('updated');
    expect(win.getTitle()).toBe('updated');
  });

  test('setSize updates bounds', () => {
    const win = new BrowserWindow();
    win.setSize(300, 200);
    expect(win.getBounds()).toEqual({ x: 0, y: 0, width: 300, height: 200 });
  });

  test('close emits closed, removes from registry, and marks destroyed', () => {
    const win = new BrowserWindow();
    let closedEvents = 0;
    win.on('closed', () => {
      closedEvents += 1;
    });
    win.close();
    expect(closedEvents).toBe(1);
    expect(win.isDestroyed()).toBe(true);
    expect(BrowserWindow.fromId(win.id)).toBeUndefined();
  });
});

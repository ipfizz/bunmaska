import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvalidArgumentError } from '../../../../src/common/errors';
import { app } from '../../../../src/main/api/app';
import {
  BrowserWindow,
  resetWindowRegistryForTesting,
} from '../../../../src/main/api/browser-window';
import { session } from '../../../../src/main/api/session';
import { resetWebContentsIdsForTesting } from '../../../../src/main/api/web-contents';
import { resetBootstrapForTesting } from '../../../../src/main/bootstrap';
import { setNativeAppForTesting } from '../../../../src/main/native-app';
import type {
  NativeApplication,
  NativeWebContents,
  NativeWindow,
  NativeWindowOptions,
  Rect,
  WindowEventType,
} from '../../../../src/main/platform/native';
import { appExitCodes, installSafeAppExit } from '../../../helpers/safe-app-exit';

type FakeWindow = NativeWindow & {
  fireClosed: () => void;
  /** Fire a non-preventable window event up through the seam. */
  fireEvent: (type: WindowEventType) => void;
  /**
   * Simulate a native close attempt: run the registered close callback. Returns
   * whether the close was vetoed (callback returned true). When not vetoed, the
   * fake fires `onClosed` like a real backend would.
   */
  fireCloseRequest: () => boolean;
  /** Number of times the (idempotent) teardown ran. */
  teardownCount: () => number;
  /** The User-Agent applied to this window's web contents, if any. */
  appliedUserAgent: () => string | undefined;
  /** The last opacity pushed to the native window, if any. */
  appliedOpacity: () => number | undefined;
  /** The last resizable flag pushed to the native window, if any. */
  appliedResizable: () => boolean | undefined;
  /** The last minimum size pushed to the native window, if any. */
  appliedMinSize: () => [number, number] | undefined;
  /** Whether `center` was called on the native window. */
  wasCentered: () => boolean;
};

const makeFakeWindow = (options: NativeWindowOptions): FakeWindow => {
  let title = options.title;
  let visible = options.show;
  let bounds: Rect = { x: 0, y: 0, width: options.width, height: options.height };
  let maximized = false;
  let minimized = false;
  let fullscreen = false;
  let focused = false;
  let onClosed: (() => void) | undefined;
  let onClose: (() => boolean) | undefined;
  let teardowns = 0;
  let tornDown = false;
  const eventCallbacks = new Map<WindowEventType, () => void>();
  const teardown = (): void => {
    if (tornDown) {
      return;
    }
    tornDown = true;
    teardowns += 1;
  };
  let appliedUserAgent: string | undefined;
  let appliedOpacity: number | undefined;
  let appliedResizable: boolean | undefined;
  let appliedMinSize: [number, number] | undefined;
  let centered = false;
  const webContents: NativeWebContents = {
    loadURL: () => undefined,
    loadHTML: () => undefined,
    getURL: () => 'about:blank',
    getTitle: () => '',
    reload: () => undefined,
    reloadIgnoringCache: () => undefined,
    stop: () => undefined,
    goBack: () => undefined,
    goForward: () => undefined,
    canGoBack: () => false,
    canGoForward: () => false,
    executeJavaScript: () => Promise.resolve(undefined),
    printToPDF: () => Promise.resolve(new Uint8Array(0)),
    capturePage: () => Promise.resolve(new Uint8Array(0)),
    openDevTools: () => undefined,
    closeDevTools: () => undefined,
    setZoomFactor: () => undefined,
    setUserAgent: (ua) => {
      appliedUserAgent = ua;
    },
    sendEnvelopeToRenderer: () => undefined,
    onRendererEnvelope: () => undefined,
    onNavigation: () => undefined,
    setWindowOpenHandler: () => undefined,
    sendInputEvent: () => undefined,
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
    setPosition: (x, y) => {
      bounds = { ...bounds, x, y };
    },
    setBounds: (b) => {
      bounds = { ...b };
    },
    getBounds: () => bounds,
    setResizable: (r) => {
      appliedResizable = r;
    },
    setOpacity: (o) => {
      appliedOpacity = o;
    },
    setMinimumSize: (w, h) => {
      appliedMinSize = [w, h];
    },
    center: () => {
      centered = true;
    },
    show: () => {
      visible = true;
    },
    hide: () => {
      visible = false;
    },
    isVisible: () => visible,
    focus: () => {
      visible = true;
      focused = true;
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
    restore: () => {
      minimized = false;
    },
    isFocused: () => focused,
    setFullScreen: (flag) => {
      fullscreen = flag;
    },
    isFullScreen: () => fullscreen,
    setAlwaysOnTop: () => undefined,
    close: () => {
      // A real backend routes programmatic close through the same delegate path:
      // consult the veto, and only on a non-veto run teardown + fire closed.
      if (onClose?.() === true) {
        return;
      }
      teardown();
      onClosed?.();
    },
    destroy: () => {
      teardown();
      onClosed?.();
    },
    onClosed: (cb) => {
      onClosed = cb;
    },
    onClose: (cb) => {
      onClose = cb;
    },
    onWindowEvent: (type, cb) => {
      eventCallbacks.set(type, cb);
    },
    popupMenu: () => undefined,
    closePopupMenu: () => undefined,
    fireClosed: () => onClosed?.(),
    fireEvent: (type) => eventCallbacks.get(type)?.(),
    fireCloseRequest: () => {
      if (onClose?.() === true) {
        return true;
      }
      teardown();
      onClosed?.();
      return false;
    },
    teardownCount: () => teardowns,
    appliedUserAgent: () => appliedUserAgent,
    appliedOpacity: () => appliedOpacity,
    appliedResizable: () => appliedResizable,
    appliedMinSize: () => appliedMinSize,
    wasCentered: () => centered,
  };
};

const makeFakeApp = (): {
  native: NativeApplication;
  created: NativeWindowOptions[];
  windows: FakeWindow[];
} => {
  const created: NativeWindowOptions[] = [];
  const windows: FakeWindow[] = [];
  const native: NativeApplication = {
    start: () => undefined,
    onReady: (cb) => cb(),
    quit: () => undefined,
    createWindow: (options) => {
      created.push(options);
      const window = makeFakeWindow(options);
      windows.push(window);
      return window;
    },
  };
  return { native, created, windows };
};

let created: NativeWindowOptions[];
let windows: FakeWindow[];

beforeEach(() => {
  resetWindowRegistryForTesting();
  resetWebContentsIdsForTesting();
  resetBootstrapForTesting();
  installSafeAppExit();
  const fake = makeFakeApp();
  created = fake.created;
  windows = fake.windows;
  setNativeAppForTesting(fake.native);
});

afterEach(() => {
  setNativeAppForTesting(undefined);
  app.resetForTesting();
  session.defaultSession.resetForTesting();
});

describe('BrowserWindow default-session user agent', () => {
  test('applies the default session user agent to a new window', () => {
    session.defaultSession.setUserAgent('Bunmaska/UA (test)');
    new BrowserWindow();
    expect(windows[0]?.appliedUserAgent()).toBe('Bunmaska/UA (test)');
  });

  test('does not override the user agent when the session has none', () => {
    new BrowserWindow();
    expect(windows[0]?.appliedUserAgent()).toBeUndefined();
  });

  test('applies app.userAgentFallback when the session has no override', () => {
    app.userAgentFallback = 'Fallback/1.0';
    new BrowserWindow();
    expect(windows[0]?.appliedUserAgent()).toBe('Fallback/1.0');
  });

  test('a session user agent takes precedence over app.userAgentFallback', () => {
    app.userAgentFallback = 'Fallback/1.0';
    session.defaultSession.setUserAgent('Session/2.0');
    new BrowserWindow();
    expect(windows[0]?.appliedUserAgent()).toBe('Session/2.0');
  });
});

describe('BrowserWindow runtime setters', () => {
  test('setResizable toggles the native window and isResizable cache', () => {
    const win = new BrowserWindow();
    expect(win.isResizable()).toBe(true);
    win.setResizable(false);
    expect(windows[0]?.appliedResizable()).toBe(false);
    expect(win.isResizable()).toBe(false);
  });

  test('isResizable reflects the constructor option', () => {
    expect(new BrowserWindow({ resizable: false }).isResizable()).toBe(false);
  });

  test('setOpacity clamps to [0,1], pushes native, and getOpacity tracks it', () => {
    const win = new BrowserWindow();
    expect(win.getOpacity()).toBe(1);
    win.setOpacity(0.5);
    expect(windows[0]?.appliedOpacity()).toBe(0.5);
    expect(win.getOpacity()).toBe(0.5);
    win.setOpacity(2);
    expect(win.getOpacity()).toBe(1);
    win.setOpacity(-1);
    expect(win.getOpacity()).toBe(0);
  });

  test('setMinimumSize pushes native and getMinimumSize tracks it', () => {
    const win = new BrowserWindow();
    expect(win.getMinimumSize()).toEqual([0, 0]);
    win.setMinimumSize(400, 300);
    expect(windows[0]?.appliedMinSize()).toEqual([400, 300]);
    expect(win.getMinimumSize()).toEqual([400, 300]);
  });

  test('getSize derives from the native bounds', () => {
    const win = new BrowserWindow({ width: 1024, height: 768 });
    expect(win.getSize()).toEqual([1024, 768]);
    win.setSize(640, 480);
    expect(win.getSize()).toEqual([640, 480]);
  });

  test('center delegates to the native window', () => {
    const win = new BrowserWindow();
    win.center();
    expect(windows[0]?.wasCentered()).toBe(true);
  });
});

describe('BrowserWindow construction', () => {
  test('applies default options when none are given', () => {
    new BrowserWindow();
    expect(created[0]).toEqual({ width: 800, height: 600, title: 'Bunmaska', show: true });
  });

  test('passes through provided options', () => {
    new BrowserWindow({ width: 1024, height: 768, title: 'My App', show: false });
    expect(created[0]).toEqual({ width: 1024, height: 768, title: 'My App', show: false });
  });

  test('forwards resizable, frame, and fullscreen when provided', () => {
    new BrowserWindow({ resizable: false, frame: false, fullscreen: true });
    expect(created[0]).toMatchObject({ resizable: false, frame: false, fullscreen: true });
  });

  test('omits resizable/frame/fullscreen when not provided', () => {
    new BrowserWindow();
    expect(created[0]).not.toHaveProperty('resizable');
    expect(created[0]).not.toHaveProperty('frame');
    expect(created[0]).not.toHaveProperty('fullscreen');
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
    dir = mkdtempSync(join(tmpdir(), 'bunmaska-preload-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('reads the preload file and passes its contents as preloadScript', () => {
    const source = 'window.__bunmaskaPreloadRan = true;\n';
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

  test('setPosition moves the window and getPosition reads it back', () => {
    const win = new BrowserWindow();
    win.setPosition(120, 80);
    expect(win.getPosition()).toEqual([120, 80]);
    expect(win.getBounds()).toMatchObject({ x: 120, y: 80 });
  });

  test('setBounds sets position and size together', () => {
    const win = new BrowserWindow();
    win.setBounds({ x: 50, y: 60, width: 800, height: 600 });
    expect(win.getBounds()).toEqual({ x: 50, y: 60, width: 800, height: 600 });
    expect(win.getPosition()).toEqual([50, 60]);
    expect(win.getSize()).toEqual([800, 600]);
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

describe('BrowserWindow lifecycle events', () => {
  const simpleEvents: WindowEventType[] = [
    'focus',
    'blur',
    'show',
    'hide',
    'resize',
    'maximize',
    'unmaximize',
    'minimize',
    'restore',
    'ready-to-show',
  ];

  for (const type of simpleEvents) {
    test(`re-emits the native '${type}' event`, () => {
      const win = new BrowserWindow();
      let fired = 0;
      win.on(type, () => {
        fired += 1;
      });
      windows[0]?.fireEvent(type);
      expect(fired).toBe(1);
    });
  }

  test('a native close request with no listeners proceeds to closed', () => {
    const win = new BrowserWindow();
    let closed = 0;
    win.on('closed', () => {
      closed += 1;
    });
    const vetoed = windows[0]?.fireCloseRequest();
    expect(vetoed).toBe(false);
    expect(closed).toBe(1);
    expect(win.isDestroyed()).toBe(true);
  });

  test("emits a preventable 'close' before 'closed' with an Electron-style event", () => {
    const win = new BrowserWindow();
    const order: string[] = [];
    let eventArg: { preventDefault: () => void; defaultPrevented: boolean } | undefined;
    win.on('close', (event) => {
      order.push('close');
      eventArg = event;
    });
    win.on('closed', () => order.push('closed'));
    windows[0]?.fireCloseRequest();
    expect(order).toEqual(['close', 'closed']);
    expect(typeof eventArg?.preventDefault).toBe('function');
    expect(eventArg?.defaultPrevented).toBe(false);
  });

  test("a 'close' listener calling preventDefault vetoes the close", () => {
    const win = new BrowserWindow();
    let closed = 0;
    win.on('close', (event) => {
      event.preventDefault();
    });
    win.on('closed', () => {
      closed += 1;
    });
    const vetoed = windows[0]?.fireCloseRequest();
    expect(vetoed).toBe(true);
    expect(closed).toBe(0);
    expect(win.isDestroyed()).toBe(false);
    expect(BrowserWindow.fromId(win.id)).toBe(win);
  });

  test('a non-prevented close after a prevented one still closes', () => {
    const win = new BrowserWindow();
    let prevent = true;
    win.on('close', (event) => {
      if (prevent) {
        event.preventDefault();
      }
    });
    expect(windows[0]?.fireCloseRequest()).toBe(true);
    expect(win.isDestroyed()).toBe(false);
    prevent = false;
    expect(windows[0]?.fireCloseRequest()).toBe(false);
    expect(win.isDestroyed()).toBe(true);
  });

  test('programmatic close() consults close listeners (preventable)', () => {
    const win = new BrowserWindow();
    win.on('close', (event) => {
      event.preventDefault();
    });
    win.close();
    expect(win.isDestroyed()).toBe(false);
  });

  test('teardown runs exactly once across repeated close attempts (idempotent)', () => {
    const win = new BrowserWindow();
    windows[0]?.fireCloseRequest();
    win.close();
    windows[0]?.fireCloseRequest();
    expect(windows[0]?.teardownCount()).toBe(1);
  });
});

describe('App-level window events', () => {
  test('constructing a window emits browser-window-created with the window', () => {
    let received: BrowserWindow | undefined;
    app.on('browser-window-created', (_event: unknown, win: BrowserWindow) => {
      received = win;
    });
    const win = new BrowserWindow();
    expect(received).toBe(win);
  });

  test('constructing a window emits web-contents-created with the web contents', () => {
    let received: unknown;
    app.on('web-contents-created', (_event: unknown, contents: unknown) => {
      received = contents;
    });
    const win = new BrowserWindow();
    expect(received).toBe(win.webContents);
  });

  test('native focus re-emits app browser-window-focus with the window', () => {
    const win = new BrowserWindow();
    let focused: BrowserWindow | undefined;
    app.on('browser-window-focus', (_event: unknown, w: BrowserWindow) => {
      focused = w;
    });
    windows[0]?.fireEvent('focus');
    expect(focused).toBe(win);
  });

  test('native blur re-emits app browser-window-blur with the window', () => {
    const win = new BrowserWindow();
    let blurred: BrowserWindow | undefined;
    app.on('browser-window-blur', (_event: unknown, w: BrowserWindow) => {
      blurred = w;
    });
    windows[0]?.fireEvent('blur');
    expect(blurred).toBe(win);
  });

  test('closing the last window emits app window-all-closed', () => {
    const win = new BrowserWindow();
    let fired = 0;
    app.on('window-all-closed', () => {
      fired += 1;
    });
    win.close();
    expect(fired).toBe(1);
  });

  test('window-all-closed fires only once the final window closes', () => {
    const a = new BrowserWindow();
    const b = new BrowserWindow();
    let fired = 0;
    app.on('window-all-closed', () => {
      fired += 1;
    });
    a.close();
    expect(fired).toBe(0);
    b.close();
    expect(fired).toBe(1);
  });

  test('closing the last window with no listener quits the app', () => {
    const win = new BrowserWindow();
    win.close();
    expect(appExitCodes()).toEqual([0]);
  });

  test('a window-all-closed listener suppresses the default quit', () => {
    const win = new BrowserWindow();
    app.on('window-all-closed', () => undefined);
    win.close();
    expect(appExitCodes()).toEqual([]);
  });
});

describe('BrowserWindow window controls', () => {
  test('restore clears the minimized state', () => {
    const win = new BrowserWindow();
    win.minimize();
    expect(win.isMinimized()).toBe(true);
    win.restore();
    expect(win.isMinimized()).toBe(false);
  });

  test('isFocused reflects the native state', () => {
    const win = new BrowserWindow();
    expect(win.isFocused()).toBe(false);
    win.focus();
    expect(win.isFocused()).toBe(true);
  });

  test('setFullScreen toggles isFullScreen', () => {
    const win = new BrowserWindow();
    expect(win.isFullScreen()).toBe(false);
    win.setFullScreen(true);
    expect(win.isFullScreen()).toBe(true);
    win.setFullScreen(false);
    expect(win.isFullScreen()).toBe(false);
  });

  test('setAlwaysOnTop does not throw', () => {
    const win = new BrowserWindow();
    expect(() => win.setAlwaysOnTop(true)).not.toThrow();
  });

  test('destroy force-closes even when a close listener vetoes', () => {
    const win = new BrowserWindow();
    win.on('close', (event) => event.preventDefault());
    win.destroy();
    expect(win.isDestroyed()).toBe(true);
    expect(BrowserWindow.fromId(win.id)).toBeUndefined();
  });
});

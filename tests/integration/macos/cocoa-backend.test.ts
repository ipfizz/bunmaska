import { describe, expect, jest, test } from 'bun:test';
import { dlopen, FFIType, ptr } from 'bun:ffi';
import { currentPlatform } from '../../../src/common/platform';
import { protocol } from '../../../src/main/api/protocol';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';
import { retainedBlockCount } from '../../../src/main/platform/macos/cocoa-block';
import { nsString, nsStringToString } from '../../../src/main/platform/macos/cocoa-foundation';
import {
  msgSendI64,
  msgSendPtr,
  msgSendPtrI64,
  msgSendReturnsI64,
  msgSendReturnsU8,
} from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import { LIBOBJC_PATH } from '../../../src/main/platform/macos/objc';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The NSWindow in NSApp's window list with this title, or 0n. */
const nsWindowTitled = (title: string): bigint => {
  const rt = cocoa();
  const app = rt.msgSend(rt.classes.get('NSApplication'), rt.selectors.get('sharedApplication'));
  const windows = rt.msgSend(app, rt.selectors.get('windows'));
  const count = rt.msgSend(windows, rt.selectors.get('count'));
  for (let i = 0n; i < count; i += 1n) {
    const window = msgSendI64(windows, rt.selectors.get('objectAtIndex:'), i);
    if (nsStringToString(rt.msgSend(window, rt.selectors.get('title'))) === title) {
      return window;
    }
  }
  return 0n;
};

const weakRefs = (): {
  readonly observe: (object: bigint) => BigUint64Array;
  readonly isAlive: (slot: BigUint64Array) => boolean;
  readonly forget: (slot: BigUint64Array) => void;
} => {
  const objc = dlopen(LIBOBJC_PATH, {
    objc_initWeak: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
    objc_loadWeakRetained: { args: [FFIType.ptr], returns: FFIType.u64 },
    objc_destroyWeak: { args: [FFIType.ptr], returns: FFIType.void },
  }).symbols;
  return {
    observe: (object) => {
      const slot = new BigUint64Array(1);
      objc.objc_initWeak(ptr(slot), object);
      return slot;
    },
    isAlive: (slot) => {
      const object = objc.objc_loadWeakRetained(ptr(slot));
      if (object !== 0n) {
        cocoa().msgSend(object, cocoa().selectors.get('release'));
      }
      return object !== 0n;
    },
    forget: (slot) => objc.objc_destroyWeak(ptr(slot)),
  };
};

/** An object's KVC `frame` (NSRect) in Cocoa's bottom-left space. */
const kvcRect = (object: bigint): { x: number; y: number; width: number; height: number } => {
  const rt = cocoa();
  const value = msgSendPtr(object, rt.selectors.get('valueForKey:'), nsString('frame'));
  const out = new Float64Array(4);
  msgSendPtrI64(value, rt.selectors.get('getValue:size:'), BigInt(ptr(out)), 32n);
  return { x: out[0] ?? 0, y: out[1] ?? 0, width: out[2] ?? 0, height: out[3] ?? 0 };
};

const waitFor = async (predicate: () => boolean, ms = 3_000): Promise<void> => {
  const deadline = performance.now() + ms;
  while (!predicate() && performance.now() < deadline) {
    await Bun.sleep(20);
  }
};

if (currentPlatform() === 'macos') {
  describe('MacOSApplication', () => {
    test('onReady fires synchronously once started', () => {
      const app = createMacOSApplication();
      let ready = false;
      app.onReady(() => {
        ready = true;
      });
      app.start();
      try {
        expect(ready).toBe(true);
      } finally {
        app.quit();
      }
    });

    test('start is idempotent', () => {
      const app = createMacOSApplication();
      app.start();
      try {
        expect(() => app.start()).not.toThrow();
      } finally {
        app.quit();
      }
    });
  });

  describe('MacOSWindow + WebContents end-to-end', () => {
    test('creates a visible window with the requested title and bounds', () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({
          width: 480,
          height: 320,
          title: 'Bunmaska Test',
          show: true,
        });
        expect(win.isVisible()).toBe(true);
        expect(win.getTitle()).toBe('Bunmaska Test');
        expect(win.getBounds().width).toBe(480);
      } finally {
        app.quit();
      }
    });

    test('setSize keeps the top-left corner', () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 400, height: 300, title: 't', show: false });
        const before = win.getBounds();
        win.setSize(640, 480);
        expect(win.getBounds()).toEqual({ x: before.x, y: before.y, width: 640, height: 480 });
        win.destroy();
      } finally {
        app.quit();
      }
    });

    test('a never-shown window opens centered and reports its real frame', () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({
          width: 320,
          height: 240,
          title: 'hidden-frame',
          show: false,
        });
        const content = kvcRect(
          cocoa().msgSend(nsWindowTitled('hidden-frame'), cocoa().selectors.get('contentView')),
        );
        const bounds = win.getBounds();
        expect(bounds.x).toBeGreaterThan(0);
        expect(bounds.width).toBe(320);
        expect(bounds.height).toBeGreaterThan(content.height);
        win.setPosition(100, 120);
        expect(win.getBounds()).toEqual({ ...bounds, x: 100, y: 120 });
        win.center();
        expect(win.getBounds()).toEqual(bounds);
        expect(
          kvcRect(
            cocoa().msgSend(nsWindowTitled('hidden-frame'), cocoa().selectors.get('contentView')),
          ).height,
        ).toBe(240);
        win.destroy();
      } finally {
        app.quit();
      }
    });

    test('runtime setters (resizable/opacity/minSize/center) drive AppKit without throwing', () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 400, height: 300, title: 't', show: false });
        expect(() => {
          win.setResizable(false);
          win.setResizable(true);
          win.setOpacity(0.5);
          win.setOpacity(1);
          win.setMinimumSize(320, 240);
          win.center();
        }).not.toThrow();
      } finally {
        app.quit();
      }
    });

    test('loadHTML drives the webview URL to the base URL after pumping', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 400, height: 300, title: 't', show: true });
        win.webContents.loadHTML('<html><body><h1>Bunmaska</h1></body></html>', 'about:blank');
        await delay(250);
        expect(win.webContents.getURL()).toBe('about:blank');
      } finally {
        app.quit();
      }
    });

    test('executeJavaScript resolves to the script completion value', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 400, height: 300, title: 't', show: true });
        win.webContents.loadHTML('<html><body>hi</body></html>', 'about:blank');
        await delay(250);
        const result = await win.webContents.executeJavaScript('2 + 3');
        expect(result).toBe(5);
      } finally {
        app.quit();
      }
    });

    test('printToPDF renders the page to real PDF bytes via a block completion handler', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 400, height: 300, title: 't', show: true });
        win.webContents.loadHTML('<html><body><h1>Bunmaska PDF</h1></body></html>', 'about:blank');
        await delay(250);
        const pdf = await win.webContents.printToPDF();
        expect(pdf.length).toBeGreaterThan(100);
        // The PDF file magic is the ASCII bytes "%PDF".
        expect(new TextDecoder().decode(pdf.slice(0, 4))).toBe('%PDF');
      } finally {
        app.quit();
      }
    });

    test('capturePage snapshots the page to PNG bytes via a block completion handler', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 320, height: 240, title: 't', show: true });
        win.webContents.loadHTML(
          '<html><body style="background:#08f">x</body></html>',
          'about:blank',
        );
        await delay(300);
        const png = await win.webContents.capturePage();
        expect(png.length).toBeGreaterThan(8);
        // PNG file magic: \x89 P N G.
        expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      } finally {
        app.quit();
      }
    });

    test('a timed-out render keeps its completion block alive until WebKit calls it', async () => {
      const app = createMacOSApplication();
      app.start();
      const win = app.createWindow({ width: 320, height: 240, title: 't', show: true });
      win.webContents.loadHTML('<p>render</p>', 'about:blank');
      await waitFor(() => win.webContents.getURL() === 'about:blank');
      // Let earlier tests' fired blocks finish their deferred cleanup before counting.
      await delay(50);
      // No pump while timers are faked, so WebKit cannot complete the render first.
      app.quit();
      const pump = createMacOSApplication();
      const baseline = retainedBlockCount();
      jest.useFakeTimers();
      try {
        const pdf = win.webContents.printToPDF();
        const png = win.webContents.capturePage();
        jest.advanceTimersByTime(30_001);
        await expect(pdf).rejects.toThrow(/timed out/);
        await expect(png).rejects.toThrow(/timed out/);
        jest.advanceTimersByTime(10);
        expect(retainedBlockCount()).toBe(baseline + 2);
      } finally {
        jest.useRealTimers();
      }
      pump.start();
      try {
        win.destroy();
        await waitFor(() => retainedBlockCount() === baseline);
        expect(retainedBlockCount()).toBe(baseline);
      } finally {
        pump.quit();
      }
    });

    test('openDevTools exists and does not throw', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 400, height: 300, title: 't', show: true });
        win.webContents.loadHTML('<html><body>hi</body></html>', 'about:blank');
        await delay(150);
        expect(typeof win.webContents.openDevTools).toBe('function');
        expect(() => win.webContents.openDevTools()).not.toThrow();
        await delay(50);
      } finally {
        app.quit();
      }
    });

    test('focus leaves a hidden window hidden, like Electron', () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 320, height: 240, title: 't', show: false });
        win.focus();
        expect(win.isVisible()).toBe(false);
        win.destroy();
      } finally {
        app.quit();
      }
    });

    test('hide makes the window not visible', () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 400, height: 300, title: 't', show: true });
        expect(win.isVisible()).toBe(true);
        win.hide();
        expect(win.isVisible()).toBe(false);
      } finally {
        app.quit();
      }
    });

    test('every window and contents call after close is a safe no-op', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 320, height: 240, title: 'closing', show: true });
        win.webContents.loadHTML('<p>x</p>', 'about:blank');
        await waitFor(() => win.webContents.getURL() === 'about:blank');
        const events: string[] = [];
        for (const type of ['show', 'hide', 'blur', 'focus', 'resize'] as const) {
          win.onWindowEvent(type, () => events.push(type));
        }
        win.close();
        const callEverything = (): void => {
          win.show();
          win.hide();
          win.focus();
          win.setTitle('after');
          win.setBounds({ x: 10, y: 10, width: 200, height: 100 });
          win.setSize(300, 200);
          win.setPosition(5, 5);
          win.setResizable(false);
          win.setOpacity(0.5);
          win.setMinimumSize(100, 100);
          win.center();
          win.minimize();
          win.restore();
          win.maximize();
          win.unmaximize();
          win.setFullScreen(true);
          win.setAlwaysOnTop(true);
          win.close();
          win.destroy();
          const contents = win.webContents;
          contents.loadURL('about:blank');
          contents.loadHTML('<p>y</p>');
          contents.reload();
          contents.reloadIgnoringCache();
          contents.stop();
          contents.goBack();
          contents.goForward();
          contents.setZoomFactor(2);
          contents.setUserAgent('ua');
          contents.openDevTools();
          contents.closeDevTools();
          contents.sendEnvelopeToRenderer('{}');
          expect(win.getTitle()).toBe('');
          expect(win.isVisible()).toBe(false);
          expect(win.isFocused()).toBe(false);
          expect(win.isMaximized()).toBe(false);
          expect(win.isMinimized()).toBe(false);
          expect(win.isFullScreen()).toBe(false);
          expect(contents.getURL()).toBe('');
          expect(contents.getTitle()).toBe('');
          expect(contents.canGoBack()).toBe(false);
          expect(contents.canGoForward()).toBe(false);
        };
        callEverything();
        // The native objects are released on a later tick; call again once they are gone.
        await Bun.sleep(100);
        callEverything();
        expect(events).toEqual([]);
      } finally {
        app.quit();
      }
    });

    test('a frameless window can become key, minimizes, resizes and closes', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({
          width: 320,
          height: 240,
          title: 'frameless',
          show: true,
          frame: false,
        });
        const window = nsWindowTitled('frameless');
        const sel = cocoa().selectors;
        expect(msgSendReturnsU8(window, sel.get('canBecomeKeyWindow'))).toBe(1);
        expect(msgSendReturnsU8(window, sel.get('canBecomeMainWindow'))).toBe(1);
        expect(msgSendReturnsI64(window, sel.get('styleMask')) & 8n).toBe(8n);
        win.minimize();
        await waitFor(() => win.isMinimized());
        expect(win.isMinimized()).toBe(true);
        let closed = 0;
        win.onClose(() => closed === 0);
        win.onClosed(() => {
          closed += 1;
        });
        win.close();
        expect(closed).toBe(0);
        win.onClose(() => false);
        win.close();
        expect(closed).toBe(1);
      } finally {
        app.quit();
      }
    });

    test('a frameless window honours resizable: false', () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({
          width: 320,
          height: 240,
          title: 'frameless-fixed',
          show: false,
          frame: false,
          resizable: false,
        });
        const window = nsWindowTitled('frameless-fixed');
        expect(msgSendReturnsI64(window, cocoa().selectors.get('styleMask')) & 8n).toBe(0n);
        win.destroy();
      } finally {
        app.quit();
      }
    });

    test('the preload, bridge and dom-ready run in the main frame only', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({
          width: 320,
          height: 240,
          title: 't',
          show: true,
          preloadScript: "window.__bunmaska.exposeInMainWorld('myApi', { v: 1 });",
        });
        let domReady = 0;
        win.webContents.onNavigation((event) => {
          if (event.type === 'dom-ready') {
            domReady += 1;
          }
        });
        win.webContents.loadHTML('<iframe srcdoc="<p>child</p>"></iframe>', 'about:blank');
        const probe = `(() => {
          const frame = document.querySelector('iframe');
          if (!frame || !frame.contentDocument || frame.contentDocument.readyState !== 'complete') {
            return null;
          }
          return [typeof window.myApi, typeof frame.contentWindow.myApi];
        })()`;
        let seen: unknown = null;
        const deadline = performance.now() + 5_000;
        while (seen === null && performance.now() < deadline) {
          await Bun.sleep(20);
          seen = await win.webContents.executeJavaScript(probe);
        }
        expect(seen).toEqual(['object', 'undefined']);
        expect(domReady).toBe(1);
      } finally {
        app.quit();
      }
    });

    test('a WebKit-native or malformed protocol.handle scheme does not abort window creation', () => {
      const app = createMacOSApplication();
      app.start();
      const serve = () => ({ data: 'x' });
      protocol.handle('https', serve);
      protocol.handle('my_app', serve);
      try {
        const win = app.createWindow({ width: 320, height: 240, title: 't', show: false });
        expect(win.getTitle()).toBe('t');
        win.destroy();
      } finally {
        protocol.unhandle('https');
        protocol.unhandle('my_app');
        app.quit();
      }
    });

    test('a closed window releases its configuration and user scripts', async () => {
      const app = createMacOSApplication();
      app.start();
      const weak = weakRefs();
      try {
        const win = app.createWindow({ width: 320, height: 240, title: 'scripts', show: true });
        const rt = cocoa();
        const webview = rt.msgSend(nsWindowTitled('scripts'), rt.selectors.get('contentView'));
        const configuration = rt.msgSend(webview, rt.selectors.get('configuration'));
        const controller = rt.msgSend(configuration, rt.selectors.get('userContentController'));
        const scripts = rt.msgSend(controller, rt.selectors.get('userScripts'));
        const slot = weak.observe(msgSendI64(scripts, rt.selectors.get('objectAtIndex:'), 0n));
        try {
          win.close();
          await waitFor(() => !weak.isAlive(slot));
          expect(weak.isAlive(slot)).toBe(false);
        } finally {
          weak.forget(slot);
        }
      } finally {
        app.quit();
      }
    });

    test('windows share one URL scheme handler', () => {
      const app = createMacOSApplication();
      app.start();
      protocol.handle('bmshared', () => ({ data: 'x' }));
      try {
        const rt = cocoa();
        const handlerOf = (title: string): bigint => {
          const webview = rt.msgSend(nsWindowTitled(title), rt.selectors.get('contentView'));
          const configuration = rt.msgSend(webview, rt.selectors.get('configuration'));
          return msgSendPtr(
            configuration,
            rt.selectors.get('urlSchemeHandlerForURLScheme:'),
            nsString('bmshared'),
          );
        };
        const first = app.createWindow({ width: 200, height: 100, title: 'scheme-a', show: false });
        const second = app.createWindow({
          width: 200,
          height: 100,
          title: 'scheme-b',
          show: false,
        });
        expect(handlerOf('scheme-a')).not.toBe(0n);
        expect(handlerOf('scheme-a')).toBe(handlerOf('scheme-b'));
        first.destroy();
        second.destroy();
      } finally {
        protocol.unhandle('bmshared');
        app.quit();
      }
    });

    test('close fires the onClosed callback once', () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 400, height: 300, title: 't', show: false });
        let closes = 0;
        win.onClosed(() => {
          closes += 1;
        });
        win.close();
        win.close();
        expect(closes).toBe(1);
      } finally {
        app.quit();
      }
    });
  });
}

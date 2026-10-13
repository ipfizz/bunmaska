import { homedir } from 'node:os';
import { join } from 'node:path';
import { UnsupportedPlatformError } from '../../../common/errors';
import { createLogger } from '../../../common/logger';
import { currentPlatform } from '../../../common/platform';
import { createMacOSApplication, createMacOSWindow } from '../macos/cocoa-backend';
import { withAutoreleasePool } from '../macos/cocoa-run-loop';
import { cocoa } from '../macos/cocoa-runtime';
import type { NativeAppKit, NativeApplication, NativeWindow, NativeWindowOptions } from '../native';
import { loadCef } from './cef-ffi';
import {
  cefLibraryPath,
  createCefBrowser,
  doCefWork,
  flushCookies,
  initializeCef,
  installCefApplicationClass,
} from './cef-runtime';
import { CefWebContents } from './cef-web-contents';

const log = createLogger('cef-backend');

const QUIT_CLOSE_TIMEOUT_MS = 2_000;
const FLUSH_GRACE_MS = 200;

/**
 * The opt-in Blink engine (D048): CEF browsers inside the macOS backend's own NSWindows,
 * so every window, menu, tray, dialog and app operation is the OS backend's and only the
 * web contents are Chromium.
 */
class CefApplication implements NativeApplication {
  readonly #libDir: string;
  readonly #host: NativeApplication;
  readonly #live = new Set<CefWebContents>();
  #readyCallbacks: Array<() => void> = [];
  #userDataPath = join(homedir(), '.bunmaska', 'blink-profile');
  #cefRunning = false;
  #started = false;
  #startError: unknown;
  readonly appKit?: NativeAppKit;

  constructor(libDir: string) {
    this.#libDir = libDir;
    this.#host = createMacOSApplication(() => {
      if (this.#cefRunning) {
        doCefWork();
      }
    });
    if (this.#host.appKit !== undefined) {
      this.appKit = this.#host.appKit;
    }
  }

  setUserDataPath(path: string): void {
    this.#userDataPath = path;
  }

  /** A failed start rethrows its error forever: cef_initialize cannot run twice in a process. */
  start(): void {
    if (this.#startError !== undefined) {
      throw this.#startError;
    }
    if (this.#started) {
      return;
    }
    this.#started = true;
    try {
      loadCef(cefLibraryPath(this.#libDir));
      installCefApplicationClass();
      this.#host.start();
      initializeCef({ libDir: this.#libDir, userDataPath: this.#userDataPath });
    } catch (error) {
      this.#startError = error;
      throw error;
    }
    this.#cefRunning = true;
    const callbacks = this.#readyCallbacks;
    this.#readyCallbacks = [];
    for (const callback of callbacks) {
      callback();
    }
  }

  onReady(callback: () => void): void {
    if (this.#cefRunning) {
      callback();
    } else {
      this.#readyCallbacks.push(callback);
    }
  }

  onActivate(callback: (hasVisibleWindows: boolean) => void): void {
    this.#host.onActivate?.(callback);
  }

  onOpenUrl(callback: (url: string) => void): void {
    this.#host.onOpenUrl?.(callback);
  }

  onOpenFile(callback: (path: string) => void): void {
    this.#host.onOpenFile?.(callback);
  }

  onQuitRequest(callback: () => void): void {
    this.#host.onQuitRequest?.(callback);
  }

  showAboutPanel(): void {
    this.#host.showAboutPanel?.();
  }

  createWindow(options: NativeWindowOptions): NativeWindow {
    const schemes = options.protocol?.schemes ?? [];
    if (schemes.length > 0) {
      // ponytail: needs the phase 2 native scheme-handler bridge in the glue (D048).
      log.warn(
        `protocol.handle schemes are not served by the Blink engine yet: ${schemes.join(', ')}`,
      );
    }
    return withAutoreleasePool(() =>
      createMacOSWindow(options, (window, _options, emit) => {
        const rt = cocoa();
        const contentView = rt.msgSend(window, rt.selectors.get('contentView'));
        const browser = createCefBrowser(contentView, options.width, options.height);
        const contents = new CefWebContents(browser, options, () => emit('ready-to-show'));
        this.#live.add(contents);
        void contents.closed.then(() => this.#live.delete(contents));
        // do_close returns 1: the browser is destroyed when CEF's host view deallocs with the
        // window, which needs the drain's rolling autorelease pool.
        return { contents, teardown: () => contents.close(), release: () => undefined };
      }),
    );
  }

  /** Close every browser and flush cookies while the pump still runs, then stop it. */
  async quit(): Promise<void> {
    if (this.#cefRunning) {
      const closing = [...this.#live].map((contents) => {
        contents.close();
        return contents.closed;
      });
      await Promise.race([Promise.all(closing), Bun.sleep(QUIT_CLOSE_TIMEOUT_MS)]);
      flushCookies();
      await Bun.sleep(FLUSH_GRACE_MS);
      // ponytail: no cef_shutdown - it blocks forever on a Mach wait under the Bun pump, so the
      // helpers exit with us and DOM storage can lose its last few seconds; fix with a symbolized CEF.
      this.#cefRunning = false;
    }
    await this.#host.quit();
  }
}

/** The Blink backend over the CEF engine in `libDir` (an installed engine's `lib/`). macOS only. */
export const createCefApplication = (libDir: string): NativeApplication => {
  if (currentPlatform() !== 'macos') {
    throw new UnsupportedPlatformError('The Blink (cef) engine runs on macOS only so far');
  }
  return new CefApplication(libDir);
};

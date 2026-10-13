import { FFIType, JSCallback, type Pointer, toArrayBuffer } from 'bun:ffi';
import { createLogger } from '../../../common/logger';
import {
  allocImmortal,
  BROWSER,
  CLIENT,
  callMethod,
  DEVTOOLS_OBSERVER,
  DISPLAY,
  FRAME,
  LIFE_SPAN,
  LOAD,
  readCefString,
  release,
  retainForever,
  SIZE,
  setPtr,
  toAddress,
} from './cef-ffi';
import { cefGlue } from './cef-glue';

const log = createLogger('cef-client');

/** What one browser's owner wants to hear. Every callback runs on the UI (= Bun main) thread. */
export type BrowserListener = {
  readonly onLoadingStateChange: (isLoading: boolean) => void;
  readonly onMainFrameLoadEnd: (httpStatus: number) => void;
  readonly onMainFrameLoadError: (code: number, text: string, url: string) => void;
  readonly onTitleChange: (title: string) => void;
  readonly onBeforePopup: (url: string) => void;
  readonly onDevToolsMessage: (text: string) => void;
  readonly onBeforeClose: () => void;
};

const listeners = new Map<number, BrowserListener>();

/** Route a browser's callbacks to `listener` until {@link unregisterBrowser}. */
export const registerBrowser = (id: number, listener: BrowserListener): void => {
  listeners.set(id, listener);
};

export const unregisterBrowser = (id: number): void => {
  listeners.delete(id);
};

/** The listener for a callback's `browser` argument; releases the reference CEF passed. */
const listenerFor = (browser: number): BrowserListener | undefined => {
  const id = Number(callMethod(browser, BROWSER.getIdentifier, [], FFIType.i32));
  release(browser);
  return listeners.get(id);
};

const isMainFrame = (frame: number): boolean => {
  const main = Number(callMethod(frame, FRAME.isMain, [], FFIType.i32)) === 1;
  release(frame);
  return main;
};

/** A UI-thread JSCallback that never lets a JS exception unwind into CEF. */
const uiCallback = (
  name: string,
  args: readonly FFIType[],
  returns: FFIType,
  body: (...values: number[]) => number | undefined,
): number => {
  const fallback = returns === FFIType.void ? undefined : 0;
  const callback = new JSCallback(
    (...raw: unknown[]) => {
      try {
        return body(...raw.map(toAddress)) ?? fallback;
      } catch (error) {
        log.error(`${name} threw`, error);
        return fallback;
      }
    },
    { args: [...args], returns },
  );
  retainForever(callback);
  return toAddress(callback.ptr);
};

const P = FFIType.ptr;

const buildClient = (): Pointer => {
  const glue = cefGlue();
  const handler = (size: number) => {
    const struct = allocImmortal(size);
    glue.initBase(struct.at, size);
    return struct;
  };

  const lifeSpan = handler(SIZE.lifeSpanHandler);
  setPtr(
    lifeSpan.buf,
    LIFE_SPAN.onBeforePopup,
    uiCallback(
      'on_before_popup',
      [P, P, P, FFIType.i32, P, P, FFIType.i32, FFIType.i32, P, P, P, P, P, P],
      FFIType.i32,
      (_self, browser, frame, _id, url) => {
        release(frame);
        listenerFor(browser)?.onBeforePopup(readCefString(url));
        return 1;
      },
    ),
  );
  setPtr(
    lifeSpan.buf,
    LIFE_SPAN.doClose,
    uiCallback('do_close', [P, P], FFIType.i32, (_self, browser) => {
      release(browser);
      return 1;
    }),
  );
  setPtr(
    lifeSpan.buf,
    LIFE_SPAN.onBeforeClose,
    uiCallback('on_before_close', [P, P], FFIType.void, (_self, browser) => {
      listenerFor(browser)?.onBeforeClose();
      return undefined;
    }),
  );

  const load = handler(SIZE.loadHandler);
  setPtr(
    load.buf,
    LOAD.onLoadingStateChange,
    uiCallback(
      'on_loading_state_change',
      [P, P, FFIType.i32, FFIType.i32, FFIType.i32],
      FFIType.void,
      (_self, browser, isLoading) => {
        listenerFor(browser)?.onLoadingStateChange(isLoading === 1);
        return undefined;
      },
    ),
  );
  setPtr(
    load.buf,
    LOAD.onLoadEnd,
    uiCallback(
      'on_load_end',
      [P, P, P, FFIType.i32],
      FFIType.void,
      (_self, browser, frame, status) => {
        const main = isMainFrame(frame);
        const listener = listenerFor(browser);
        if (main) {
          listener?.onMainFrameLoadEnd(status);
        }
        return undefined;
      },
    ),
  );
  setPtr(
    load.buf,
    LOAD.onLoadError,
    uiCallback(
      'on_load_error',
      [P, P, P, FFIType.i32, P, P],
      FFIType.void,
      (_self, browser, frame, code, text, url) => {
        const main = isMainFrame(frame);
        const listener = listenerFor(browser);
        if (main) {
          listener?.onMainFrameLoadError(code, readCefString(text), readCefString(url));
        }
        return undefined;
      },
    ),
  );

  const display = handler(SIZE.displayHandler);
  setPtr(
    display.buf,
    DISPLAY.onTitleChange,
    uiCallback('on_title_change', [P, P, P], FFIType.void, (_self, browser, title) => {
      listenerFor(browser)?.onTitleChange(readCefString(title));
      return undefined;
    }),
  );

  const client = allocImmortal(SIZE.client + 3 * 8);
  glue.initBase(client.at, SIZE.client);
  setPtr(client.buf, CLIENT.getDisplayHandler, glue.slotGetter(0));
  setPtr(client.buf, CLIENT.getLifeSpanHandler, glue.slotGetter(1));
  setPtr(client.buf, CLIENT.getLoadHandler, glue.slotGetter(2));
  setPtr(client.buf, SIZE.client, display.at);
  setPtr(client.buf, SIZE.client + 8, lifeSpan.at);
  setPtr(client.buf, SIZE.client + 16, load.at);
  return client.at;
};

const buildObserver = (): Pointer => {
  const observer = allocImmortal(SIZE.devToolsObserver);
  cefGlue().initBase(observer.at, SIZE.devToolsObserver);
  const decoder = new TextDecoder();
  setPtr(
    observer.buf,
    DEVTOOLS_OBSERVER.onDevToolsMessage,
    uiCallback(
      'on_dev_tools_message',
      [P, P, P, FFIType.u64],
      FFIType.i32,
      (_self, browser, message, size) => {
        const text = decoder.decode(toArrayBuffer(message as Pointer, 0, size));
        listenerFor(browser)?.onDevToolsMessage(text);
        return 1;
      },
    ),
  );
  return observer.at;
};

let client: Pointer | undefined;
let observer: Pointer | undefined;

/** The one immortal `cef_client_t` every bunmaska browser shares. */
export const sharedClient = (): Pointer => {
  client ??= buildClient();
  return client;
};

/** The one immortal DevTools message observer every browser registers. */
export const sharedDevToolsObserver = (): Pointer => {
  observer ??= buildObserver();
  return observer;
};

import { BunmaskaError } from '../../common/errors';

/**
 * Renderer-side IPC — the drop-in equivalent of Electron's `ipcRenderer`.
 *
 * A thin, typed wrapper over the `globalThis.__bunmaska` bridge installed by the
 * preload bootstrap. `on` listeners receive an event object as their first
 * argument to match Electron's `(event, ...args)` shape (the event is a
 * placeholder for now; sender/port details arrive in a later phase).
 */

type BridgeListener = (...args: unknown[]) => void;

type RendererBridge = {
  send: (channel: string, ...args: unknown[]) => void;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (channel: string, listener: BridgeListener) => void;
  once: (channel: string, listener: BridgeListener) => void;
  removeListener: (channel: string, listener: BridgeListener) => void;
  removeAllListeners: (channel?: string) => void;
};

export type IpcRendererEvent = Record<string, never>;

export type IpcRendererListener = (event: IpcRendererEvent, ...args: unknown[]) => void;

export type IpcRenderer = {
  send(channel: string, ...args: unknown[]): void;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: IpcRendererListener): void;
  once(channel: string, listener: IpcRendererListener): void;
  removeListener(channel: string, listener: IpcRendererListener): void;
  removeAllListeners(channel?: string): void;
};

const getBridge = (): RendererBridge => {
  const bridge = Reflect.get(globalThis, '__bunmaska') as RendererBridge | undefined;
  if (bridge === undefined) {
    throw new BunmaskaError(
      'Bunmaska preload bridge is not available; ensure a preload script ran before renderer code',
    );
  }
  return bridge;
};

type WrapperEntry = { channel: string; listener: IpcRendererListener; wrapper: BridgeListener };

/** Create the `ipcRenderer` object bound to the current page's bridge. */
export const createIpcRenderer = (): IpcRenderer => {
  // The bridge stores the WRAPPED listener (one that injects the event arg), so
  // removeListener must look up the exact wrapper registered for a (channel,
  // listener) pair. Tracked per ipcRenderer instance.
  const wrappers: WrapperEntry[] = [];

  const wrap = (channel: string, listener: IpcRendererListener): BridgeListener => {
    const wrapper: BridgeListener = (...args) => listener({}, ...args);
    wrappers.push({ channel, listener, wrapper });
    return wrapper;
  };

  const takeWrapper = (
    channel: string,
    listener: IpcRendererListener,
  ): BridgeListener | undefined => {
    const index = wrappers.findIndex((e) => e.channel === channel && e.listener === listener);
    if (index === -1) {
      return undefined;
    }
    const [entry] = wrappers.splice(index, 1);
    return entry?.wrapper;
  };

  return {
    send(channel, ...args) {
      getBridge().send(channel, ...args);
    },
    invoke(channel, ...args) {
      return getBridge().invoke(channel, ...args);
    },
    on(channel, listener) {
      getBridge().on(channel, wrap(channel, listener));
    },
    once(channel, listener) {
      // The bridge drops the wrapper after one dispatch, so the tracked wrapper
      // also drops its own entry when it fires (keeps removeListener consistent).
      const wrapper: BridgeListener = (...args) => {
        takeWrapper(channel, listener);
        listener({}, ...args);
      };
      wrappers.push({ channel, listener, wrapper });
      getBridge().once(channel, wrapper);
    },
    removeListener(channel, listener) {
      const wrapper = takeWrapper(channel, listener);
      if (wrapper !== undefined) {
        getBridge().removeListener(channel, wrapper);
      }
    },
    removeAllListeners(channel) {
      if (channel === undefined) {
        wrappers.length = 0;
      } else {
        for (let i = wrappers.length - 1; i >= 0; i -= 1) {
          if (wrappers[i]?.channel === channel) {
            wrappers.splice(i, 1);
          }
        }
      }
      getBridge().removeAllListeners(channel);
    },
  };
};

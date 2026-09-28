import { createLogger } from '../../common/logger';
import type { InvokeEnvelope, ReplyEnvelope, SendEnvelope } from '../ipc/ipc-protocol';
import type { WebContents } from './web-contents';

export type IpcMainInvokeEvent = {
  readonly sender: WebContents;
};

export type IpcMainEvent = IpcMainInvokeEvent & {
  /** Sends to the renderer the message came from. */
  reply(channel: string, ...args: readonly unknown[]): void;
};

const log = createLogger('ipc-main');

const describeError = (error: unknown): string => {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return 'non-printable error';
  }
};

type Listener = (event: IpcMainEvent, ...args: readonly unknown[]) => void;
type Handler = (event: IpcMainInvokeEvent, ...args: readonly unknown[]) => unknown;

export class IpcMainImpl {
  readonly #listeners = new Map<string, Set<Listener>>();
  readonly #handlers = new Map<string, Handler>();

  on(channel: string, listener: Listener): this {
    const set = this.#listeners.get(channel) ?? new Set<Listener>();
    set.add(listener);
    this.#listeners.set(channel, set);
    return this;
  }

  once(channel: string, listener: Listener): this {
    const wrapper: Listener = (event, ...args) => {
      this.removeListener(channel, wrapper);
      listener(event, ...args);
    };
    return this.on(channel, wrapper);
  }

  removeListener(channel: string, listener: Listener): this {
    this.#listeners.get(channel)?.delete(listener);
    return this;
  }

  removeAllListeners(channel?: string): this {
    if (channel === undefined) {
      this.#listeners.clear();
    } else {
      this.#listeners.delete(channel);
    }
    return this;
  }

  handle(channel: string, handler: Handler): void {
    this.#handlers.set(channel, handler);
  }

  handleOnce(channel: string, handler: Handler): void {
    const wrapper: Handler = (event, ...args) => {
      this.#handlers.delete(channel);
      return handler(event, ...args);
    };
    this.#handlers.set(channel, wrapper);
  }

  removeHandler(channel: string): void {
    this.#handlers.delete(channel);
  }

  /** @internal The transport's entry: a reply envelope for `invoke`, `undefined` for `send`. */
  async dispatch(
    envelope: SendEnvelope | InvokeEnvelope,
    event: IpcMainEvent,
  ): Promise<ReplyEnvelope | undefined> {
    if (envelope.kind === 'send') {
      for (const listener of [...(this.#listeners.get(envelope.channel) ?? [])]) {
        try {
          listener(event, ...envelope.args);
        } catch (error) {
          log.error(`ipcMain listener for '${envelope.channel}' threw`, error);
        }
      }
      return undefined;
    }
    return this.#dispatchInvoke(envelope, event);
  }

  async #dispatchInvoke(
    envelope: InvokeEnvelope,
    event: IpcMainInvokeEvent,
  ): Promise<ReplyEnvelope> {
    const handler = this.#handlers.get(envelope.channel);
    if (handler === undefined) {
      return {
        kind: 'reply',
        id: envelope.id,
        ok: false,
        error: `No handler registered for '${envelope.channel}'`,
      };
    }
    try {
      const result = await handler(event, ...envelope.args);
      return { kind: 'reply', id: envelope.id, ok: true, result };
    } catch (error) {
      return { kind: 'reply', id: envelope.id, ok: false, error: describeError(error) };
    }
  }
}

/** Electron's `ipcMain`. */
export const ipcMain = new IpcMainImpl();

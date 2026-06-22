import type { InvokeEnvelope, ReplyEnvelope, SendEnvelope } from '../ipc/ipc-protocol';

/**
 * Main-process IPC — the drop-in equivalent of Electron's `ipcMain`.
 *
 * `on`/`once`/`removeListener` register fire-and-forget channel listeners;
 * `handle`/`removeHandler` register request/response handlers (one per channel)
 * for `ipcRenderer.invoke`. The transport (WKScriptMessageHandler inbound,
 * `evaluateJavaScript` outbound) calls {@link IpcMainImpl.dispatch}; the router
 * itself is transport-agnostic and unit-tested without any FFI.
 */

/** Event passed to `on` listeners. `sender` is the originating `WebContents`. */
export type IpcMainEvent = {
  readonly sender: unknown;
};

/** Event passed to `handle` handlers. */
export type IpcMainInvokeEvent = {
  readonly sender: unknown;
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

  /**
   * Route an inbound envelope from a renderer. Returns a reply envelope for
   * `invoke` (success or error), or `undefined` for `send`.
   * @internal Called by the IPC transport.
   */
  async dispatch(
    envelope: SendEnvelope | InvokeEnvelope,
    event: IpcMainEvent,
  ): Promise<ReplyEnvelope | undefined> {
    if (envelope.kind === 'send') {
      for (const listener of [...(this.#listeners.get(envelope.channel) ?? [])]) {
        listener(event, ...envelope.args);
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
      const message = error instanceof Error ? error.message : String(error);
      return { kind: 'reply', id: envelope.id, ok: false, error: message };
    }
  }
}

/** The main-process IPC singleton. Drop-in equivalent of Electron's `ipcMain`. */
export const ipcMain = new IpcMainImpl();

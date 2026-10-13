import { BunmaskaError } from '../../../common/errors';

export type CdpParams = Readonly<Record<string, unknown>>;
type Pending = {
  readonly resolve: (result: CdpParams) => void;
  readonly reject: (error: Error) => void;
};

/**
 * One Chrome DevTools Protocol session over CEF's in-process DevTools channel
 * (`send_dev_tools_message` out, the message observer in). Transport-agnostic so
 * the routing is testable without CEF.
 */
export class CdpSession {
  readonly #send: (json: string) => boolean;
  readonly #pending = new Map<number, Pending>();
  readonly #listeners = new Map<string, Array<(params: CdpParams) => void>>();
  #nextId = 1;
  #closedReason: string | undefined;

  constructor(send: (json: string) => boolean) {
    this.#send = send;
  }

  /** Invoke a method; resolves with its `result`, rejects on a protocol error. */
  call(method: string, params: CdpParams = {}): Promise<CdpParams> {
    if (this.#closedReason !== undefined) {
      return Promise.reject(new BunmaskaError(`CDP ${method}: ${this.#closedReason}`));
    }
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      if (!this.#send(JSON.stringify({ id, method, params }))) {
        this.#pending.delete(id);
        reject(new BunmaskaError(`CDP ${method}: the DevTools channel refused the message`));
      }
    });
  }

  /** Subscribe to a protocol event (`Runtime.bindingCalled`, ...). */
  on(method: string, listener: (params: CdpParams) => void): void {
    const list = this.#listeners.get(method) ?? [];
    list.push(listener);
    this.#listeners.set(method, list);
  }

  /** Feed one raw message from the observer. Malformed input is dropped. */
  receive(text: string): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message === null || typeof message !== 'object') {
      return;
    }
    const record = message as Record<string, unknown>;
    const id = record['id'];
    if (typeof id === 'number') {
      const slot = this.#pending.get(id);
      if (slot === undefined) {
        return;
      }
      this.#pending.delete(id);
      const error = record['error'];
      if (error !== undefined) {
        const detail = (error as Record<string, unknown>)['message'];
        slot.reject(
          new BunmaskaError(`CDP error: ${typeof detail === 'string' ? detail : 'unknown'}`),
        );
      } else {
        slot.resolve((record['result'] as CdpParams | undefined) ?? {});
      }
      return;
    }
    const method = record['method'];
    if (typeof method === 'string') {
      const params = (record['params'] as CdpParams | undefined) ?? {};
      for (const listener of this.#listeners.get(method) ?? []) {
        listener(params);
      }
    }
  }

  /** Reject every in-flight call and refuse new ones (the browser is gone). */
  close(reason: string): void {
    this.#closedReason = reason;
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const slot of pending) {
      slot.reject(new BunmaskaError(`CDP: ${reason}`));
    }
  }
}

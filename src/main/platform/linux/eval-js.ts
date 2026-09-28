import { createLogger } from '../../../common/logger';
import { buildExecWrapper, EXEC_TIMEOUT_MS } from '../../ipc/exec-wrapper';
import { EXEC_HANDLER_NAME } from './webkit-ipc';

const log = createLogger('linux-eval-js');

type PendingExec = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

/** In-flight `executeJavaScript` calls, settled by the execId the page-world wrapper posts back. */
export class ExecResultChannel {
  readonly #evalInPage: (source: string) => void;
  readonly #pending = new Map<number, PendingExec>();
  #nextExecId = 1;
  #destroyed = false;

  constructor(evalInPage: (source: string) => void) {
    this.#evalInPage = evalInPage;
  }

  executeJavaScript(code: string): Promise<unknown> {
    if (this.#destroyed) {
      return Promise.reject(new Error('executeJavaScript failed: web contents destroyed'));
    }
    const execId = this.#nextExecId;
    this.#nextExecId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(execId);
        reject(new Error(`executeJavaScript timed out after ${EXEC_TIMEOUT_MS}ms`));
      }, EXEC_TIMEOUT_MS);
      this.#pending.set(execId, { resolve, reject, timer });
      this.#evalInPage(buildExecWrapper(execId, EXEC_HANDLER_NAME, code));
    });
  }

  /** Settle the exec named by a posted `{ execId, ok, result?, error? }`; malformed or unknown ids are dropped. */
  deliverExecResult(json: string): void {
    let outcome: { execId?: number; ok?: boolean; result?: unknown; error?: string };
    try {
      outcome = JSON.parse(json);
    } catch (error) {
      log.warn('dropping malformed exec result', error);
      return;
    }
    if (typeof outcome.execId !== 'number') {
      return;
    }
    const pending = this.#pending.get(outcome.execId);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timer);
    this.#pending.delete(outcome.execId);
    if (outcome.ok) {
      pending.resolve(outcome.result);
    } else {
      pending.reject(new Error(outcome.error ?? 'executeJavaScript failed'));
    }
  }

  /**
   * Block new execs and resolve in-flight ones to `undefined`: a rejection here
   * would reach fire-and-forget callers as an unhandled rejection, which kills Bun.
   */
  destroy(): void {
    this.#destroyed = true;
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.resolve(undefined);
    }
    this.#pending.clear();
  }
}

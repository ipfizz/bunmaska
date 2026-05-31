import type { Pointer } from 'bun:ffi';
import { createLogger } from '../../../common/logger';
import { buildExecWrapper } from '../../ipc/exec-wrapper';
import { EXEC_HANDLER_NAME, evalInPageWorld } from './webkit-ipc';

/**
 * `WebContents.executeJavaScript` on Linux (WebKitGTK 6.0).
 *
 * The result returns out-of-band through a PAGE-world `sambarExec`
 * script-message handler — EXACTLY mirroring the macOS implementation. A
 * per-call `GAsyncReadyCallback` (a `bun:ffi` {@link JSCallback}) cannot be used:
 * closing it during its own invocation frees the native trampoline WebKit is
 * still returning into → SIGSEGV. Instead a wrapper runs the user code and posts
 * `{ execId, ok, result?, error? }` to the `sambarExec` handler (registered once
 * in `createWebViewWithIpc` and closed only on window teardown), which settles
 * the matching pending Promise here.
 *
 * The wrapper is injected via the EXISTING fire-and-forget page-world eval path
 * ({@link evalInPageWorld}) — NO native callback, so there is nothing to free.
 */

const log = createLogger('linux-eval-js');

/** Reject + clear a pending `executeJavaScript` after this long (ms). */
export const EXEC_TIMEOUT_MS = 30_000;

/** A pending `executeJavaScript` awaiting its page-world result message. */
type PendingExec = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

/**
 * Per-`LinuxWebContents` registry of in-flight `executeJavaScript` calls. Issues
 * a monotonic `execId`, injects the wrapper, and settles each Promise when the
 * matching `sambarExec` message arrives (or on timeout / teardown). There is NO
 * native callback to close — the page-world handler is shared and torn down with
 * the window — so this is SAFE.
 */
export class ExecResultChannel {
  readonly #view: Pointer;
  readonly #pending = new Map<number, PendingExec>();
  #nextExecId = 1;

  constructor(view: Pointer) {
    this.#view = view;
  }

  /**
   * Evaluate `code` in the PAGE world and resolve to its completion value
   * (Electron semantics). The outcome arrives via {@link deliverExecResult}.
   */
  executeJavaScript(code: string): Promise<unknown> {
    const execId = this.#nextExecId;
    this.#nextExecId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(execId);
        reject(new Error(`executeJavaScript timed out after ${EXEC_TIMEOUT_MS}ms`));
      }, EXEC_TIMEOUT_MS);
      this.#pending.set(execId, { resolve, reject, timer });
      evalInPageWorld(this.#view, buildExecWrapper(execId, EXEC_HANDLER_NAME, code));
    });
  }

  /**
   * Settle the pending exec for the `{ execId, ok, result?, error? }` JSON the
   * page-world `sambarExec` handler posted. Malformed / unknown ids are dropped.
   */
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

  /** Reject every still-pending exec; called on window close. */
  rejectPending(): void {
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('executeJavaScript aborted: web contents destroyed'));
    }
    this.#pending.clear();
  }
}

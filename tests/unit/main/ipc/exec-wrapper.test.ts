import { describe, expect, test } from 'bun:test';
import { buildExecWrapper } from '../../../../src/main/ipc/exec-wrapper';

/**
 * The wrapper-source generator is pure string-building, so it is unit-testable
 * on any platform. It must embed the exec id, the user code, and reference the
 * page-world return-channel handler name so the outcome posts back.
 */

type Outcome = { execId: number; ok: boolean; result?: unknown; error?: string };

/**
 * Run a generated wrapper string in this runtime by faking the page-world
 * `window.webkit.messageHandlers.<name>.postMessage` channel and awaiting the
 * posted JSON. Lets the test observe the outcome WITHOUT reimplementing the
 * generator.
 */
const runWrapper = (source: string): Promise<Outcome> =>
  new Promise<Outcome>((resolve) => {
    const fakeWindow = {
      webkit: {
        messageHandlers: {
          sambarExec: {
            postMessage: (json: string): void => resolve(JSON.parse(json) as Outcome),
          },
        },
      },
    };
    new Function('window', source)(fakeWindow);
  });

describe('buildExecWrapper', () => {
  test('embeds the exec id, handler name, and user code', () => {
    const source = buildExecWrapper(7, 'sambarExec', '1 + 1');
    expect(source).toContain('7');
    expect(source).toContain('sambarExec');
    // The user code is JSON-encoded into the wrapper so it round-trips safely.
    expect(source).toContain(JSON.stringify('1 + 1'));
    expect(source).toContain('postMessage');
  });

  test('safely embeds code containing quotes and newlines', () => {
    const code = 'const s = "a\nb\'c"; s';
    const source = buildExecWrapper(1, 'sambarExec', code);
    expect(source).toContain(JSON.stringify(code));
  });

  test('returns the completion value of an expression', async () => {
    expect(await runWrapper(buildExecWrapper(42, 'sambarExec', '1 + 1'))).toMatchObject({
      execId: 42,
      ok: true,
      result: 2,
    });
  });

  test('resolves a Promise result to its fulfilled value', async () => {
    expect(
      await runWrapper(buildExecWrapper(5, 'sambarExec', 'Promise.resolve("hi")')),
    ).toMatchObject({ execId: 5, ok: true, result: 'hi' });
  });

  test('reports a thrown error as an unsuccessful outcome', async () => {
    const outcome = await runWrapper(buildExecWrapper(9, 'sambarExec', 'throw new Error("boom")'));
    expect(outcome.ok).toBe(false);
    expect(outcome.execId).toBe(9);
    expect(outcome.error).toContain('boom');
  });
});

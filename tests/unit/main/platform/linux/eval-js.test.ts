import { describe, expect, test } from 'bun:test';
import { ExecResultChannel } from '../../../../../src/main/platform/linux/eval-js';

/** A channel whose injected evaluator records the execId of each wrapper it runs. */
const channel = () => {
  const ids: number[] = [];
  const exec = new ExecResultChannel((source) => {
    const match = /execId: (\d+)/.exec(source);
    ids.push(Number(match?.[1]));
  });
  const deliver = (execId: number | undefined, ok: boolean, result?: unknown) =>
    exec.deliverExecResult(JSON.stringify({ execId, ok, result, error: 'page threw' }));
  return { exec, ids, deliver };
};

describe('ExecResultChannel', () => {
  test('settles the pending call whose execId the page posts back', async () => {
    const { exec, ids, deliver } = channel();
    const result = exec.executeJavaScript('1 + 1');
    deliver(ids[0], true, 2);
    expect(await result).toBe(2);
  });

  test('rejects with the page error when the wrapper reports ok: false', async () => {
    const { exec, ids, deliver } = channel();
    const result = exec.executeJavaScript('boom()');
    deliver(ids[0], false);
    await expect(result).rejects.toThrow('page threw');
  });

  test('malformed and unknown results are dropped without throwing', () => {
    const { exec } = channel();
    expect(() => exec.deliverExecResult('{not json')).not.toThrow();
    expect(() => exec.deliverExecResult('{"ok":true}')).not.toThrow();
  });

  test('destroy resolves in-flight calls to undefined and rejects later ones', async () => {
    const { exec } = channel();
    const inFlight = exec.executeJavaScript('1');
    exec.destroy();
    expect(await inFlight).toBeUndefined();
    await expect(exec.executeJavaScript('2')).rejects.toThrow('destroyed');
  });
});

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

const isPending = async (promise: Promise<unknown>): Promise<boolean> => {
  const marker = Symbol('pending');
  return (await Promise.race([promise, Promise.resolve(marker)])) === marker;
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

  test('a guessed sequential execId cannot settle a pending call', async () => {
    const { exec, ids, deliver } = channel();
    const result = exec.executeJavaScript('document.title');
    for (let guess = 0; guess < 100; guess += 1) {
      deliver(guess, true, 'forged');
    }
    expect(await isPending(result)).toBe(true);
    deliver(ids[0], true, 'real');
    expect(await result).toBe('real');
  });

  test('malformed and unknown results are dropped without throwing', () => {
    const { exec } = channel();
    expect(() => exec.deliverExecResult('{not json')).not.toThrow();
    expect(() => exec.deliverExecResult('{"ok":true}')).not.toThrow();
  });

  test('a page posting null or a primitive is dropped without throwing', () => {
    const { exec } = channel();
    expect(() => exec.deliverExecResult('null')).not.toThrow();
    expect(() => exec.deliverExecResult('7')).not.toThrow();
  });

  test('destroy resolves in-flight calls to undefined and rejects later ones', async () => {
    const { exec } = channel();
    const inFlight = exec.executeJavaScript('1');
    exec.destroy();
    expect(await inFlight).toBeUndefined();
    await expect(exec.executeJavaScript('2')).rejects.toThrow('destroyed');
  });
});

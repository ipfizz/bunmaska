import { describe, expect, test } from 'bun:test';
import { InvalidArgumentError } from '../../../../src/common/errors';
import {
  decodeEnvelope,
  encodeEnvelope,
  type IpcEnvelope,
} from '../../../../src/main/ipc/ipc-protocol';

describe('encodeEnvelope / decodeEnvelope round-trip', () => {
  const cases: ReadonlyArray<IpcEnvelope> = [
    { kind: 'send', channel: 'ping', args: [] },
    { kind: 'send', channel: 'data', args: [1, 'two', { three: true }, [4]] },
    { kind: 'invoke', id: 7, channel: 'compute', args: [41] },
    { kind: 'reply', id: 7, ok: true, result: 42 },
    { kind: 'reply', id: 9, ok: false, error: 'boom' },
  ];

  for (const env of cases) {
    test(`round-trips ${env.kind} ${JSON.stringify(env)}`, () => {
      expect(decodeEnvelope(encodeEnvelope(env))).toEqual(env);
    });
  }
});

describe('encodeEnvelope', () => {
  test('produces a JSON string', () => {
    const encoded = encodeEnvelope({ kind: 'send', channel: 'x', args: [] });
    expect(typeof encoded).toBe('string');
    expect(JSON.parse(encoded)).toBeDefined();
  });

  test('throws InvalidArgumentError when args contain a function', () => {
    expect(() =>
      encodeEnvelope({ kind: 'send', channel: 'x', args: [() => undefined] as never }),
    ).toThrow(InvalidArgumentError);
  });
});

describe('decodeEnvelope validation', () => {
  test('throws InvalidArgumentError on non-JSON input', () => {
    expect(() => decodeEnvelope('not json{')).toThrow(InvalidArgumentError);
  });

  test('throws InvalidArgumentError on an unknown kind', () => {
    expect(() => decodeEnvelope(JSON.stringify({ kind: 'mystery' }))).toThrow(InvalidArgumentError);
  });

  test('throws InvalidArgumentError when a send envelope is missing channel', () => {
    expect(() => decodeEnvelope(JSON.stringify({ kind: 'send', args: [] }))).toThrow(
      InvalidArgumentError,
    );
  });

  test('throws InvalidArgumentError when an invoke envelope is missing id', () => {
    expect(() =>
      decodeEnvelope(JSON.stringify({ kind: 'invoke', channel: 'x', args: [] })),
    ).toThrow(InvalidArgumentError);
  });

  test('throws InvalidArgumentError when args is not an array', () => {
    expect(() =>
      decodeEnvelope(JSON.stringify({ kind: 'send', channel: 'x', args: 'nope' })),
    ).toThrow(InvalidArgumentError);
  });
});

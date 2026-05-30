import { InvalidArgumentError } from '../../common/errors';

/**
 * Wire protocol for Sambar IPC (D021). Messages cross the in-process boundary
 * (renderer ⇄ main) as JSON strings: the renderer posts them through a
 * `WKScriptMessageHandler`, the main side delivers them via `evaluateJavaScript`.
 *
 * Three envelope kinds:
 * - `send`   — fire-and-forget event on a channel (either direction).
 * - `invoke` — request expecting a `reply`, correlated by `id` (renderer→main).
 * - `reply`  — response to an `invoke` (main→renderer).
 */

export type SendEnvelope = {
  readonly kind: 'send';
  readonly channel: string;
  readonly args: readonly unknown[];
};

export type InvokeEnvelope = {
  readonly kind: 'invoke';
  readonly id: number;
  readonly channel: string;
  readonly args: readonly unknown[];
};

export type ReplyEnvelope =
  | { readonly kind: 'reply'; readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly kind: 'reply'; readonly id: number; readonly ok: false; readonly error: string };

export type IpcEnvelope = SendEnvelope | InvokeEnvelope | ReplyEnvelope;

/** Serialize an envelope to a JSON string, rejecting non-serializable payloads. */
export const encodeEnvelope = (envelope: IpcEnvelope): string => {
  try {
    const json = JSON.stringify(envelope, (_key, value) => {
      if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
        throw new InvalidArgumentError(`IPC payload contains a non-serializable ${typeof value}`);
      }
      return value;
    });
    if (json === undefined) {
      throw new InvalidArgumentError('IPC payload could not be serialized');
    }
    return json;
  } catch (error) {
    if (error instanceof InvalidArgumentError) {
      throw error;
    }
    throw new InvalidArgumentError('IPC payload could not be serialized', { cause: error });
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Parse and validate a JSON string into a typed {@link IpcEnvelope}. */
export const decodeEnvelope = (raw: string): IpcEnvelope => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new InvalidArgumentError('IPC message is not valid JSON', { cause: error });
  }
  if (!isObject(parsed)) {
    throw new InvalidArgumentError('IPC message must be an object');
  }

  const { kind } = parsed;
  if (kind === 'send') {
    return { kind: 'send', channel: requireChannel(parsed), args: requireArgs(parsed) };
  }
  if (kind === 'invoke') {
    return {
      kind: 'invoke',
      id: requireId(parsed),
      channel: requireChannel(parsed),
      args: requireArgs(parsed),
    };
  }
  if (kind === 'reply') {
    return decodeReply(parsed);
  }
  throw new InvalidArgumentError(`Unknown IPC envelope kind: ${String(kind)}`);
};

const requireChannel = (o: Record<string, unknown>): string => {
  if (typeof o.channel !== 'string') {
    throw new InvalidArgumentError('IPC envelope is missing a string channel');
  }
  return o.channel;
};

const requireArgs = (o: Record<string, unknown>): readonly unknown[] => {
  if (!Array.isArray(o.args)) {
    throw new InvalidArgumentError('IPC envelope args must be an array');
  }
  return o.args;
};

const requireId = (o: Record<string, unknown>): number => {
  if (typeof o.id !== 'number') {
    throw new InvalidArgumentError('IPC envelope is missing a numeric id');
  }
  return o.id;
};

const decodeReply = (o: Record<string, unknown>): ReplyEnvelope => {
  const id = requireId(o);
  if (o.ok === true) {
    return { kind: 'reply', id, ok: true, result: o.result };
  }
  if (o.ok === false) {
    if (typeof o.error !== 'string') {
      throw new InvalidArgumentError('IPC error reply is missing a string error');
    }
    return { kind: 'reply', id, ok: false, error: o.error };
  }
  throw new InvalidArgumentError('IPC reply envelope is missing a boolean ok');
};

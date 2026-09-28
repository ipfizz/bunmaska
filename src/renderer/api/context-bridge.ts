import { BunmaskaError } from '../../common/errors';
import {
  CHANNEL_GLOBAL_KEY,
  type CustomEventCtor,
  type EventScope,
  installCrossWorldHost,
} from './cross-world-bridge';

// The security contract is the LIMITATIONS block in cross-world-bridge.ts.

export type ContextBridge = {
  exposeInMainWorld(key: string, api: Record<string, unknown>): void;
};

export type ContextBridgeTransport = {
  /** Per-window random channel id shared with the page-world stub. */
  readonly channelId: string;
  /** The shared `document` both worlds dispatch events on. */
  readonly scope: EventScope;
  readonly CustomEventImpl: CustomEventCtor;
};

type ExposeFn = (key: string, api: Record<string, unknown>) => void;

/** The backend-injected host; sharing it keeps one key registry per world. */
const injectedExpose = (): ExposeFn | undefined => {
  const bridge = Reflect.get(globalThis, '__bunmaska') as
    | { exposeInMainWorld?: unknown }
    | undefined;
  return typeof bridge?.exposeInMainWorld === 'function'
    ? (bridge.exposeInMainWorld as ExposeFn)
    : undefined;
};

const resolveTransport = (
  override?: ContextBridgeTransport,
): ContextBridgeTransport | undefined => {
  if (override !== undefined) {
    return override;
  }
  const channelId = Reflect.get(globalThis, CHANNEL_GLOBAL_KEY) as string | undefined;
  const doc = Reflect.get(globalThis, 'document') as EventScope | undefined;
  const CustomEventImpl = Reflect.get(globalThis, 'CustomEvent') as CustomEventCtor | undefined;
  if (typeof channelId !== 'string' || doc === undefined || CustomEventImpl === undefined) {
    return undefined;
  }
  return { channelId, scope: doc, CustomEventImpl };
};

/** Create the `contextBridge`, sharing the injected host or else installing one. */
export const createContextBridge = (override?: ContextBridgeTransport): ContextBridge => {
  let expose: ExposeFn | undefined;
  return {
    exposeInMainWorld(key, api) {
      if (expose === undefined && override === undefined) {
        expose = injectedExpose();
      }
      if (expose === undefined) {
        const transport = resolveTransport(override);
        if (transport === undefined) {
          throw new BunmaskaError(
            'contextBridge: no cross-world channel is available; exposeInMainWorld must run in the Bunmaska isolated preload world',
          );
        }
        expose = installCrossWorldHost(
          transport.channelId,
          transport.scope,
          transport.CustomEventImpl,
        );
      }
      try {
        expose(key, api);
      } catch (error) {
        throw new BunmaskaError(error instanceof Error ? error.message : String(error), {
          cause: error,
        });
      }
    },
  };
};

import { BunmaskaError } from '../../common/errors';
import {
  CHANNEL_GLOBAL_KEY,
  type CustomEventCtor,
  type EventScope,
  installCrossWorldHost,
} from './cross-world-bridge';

/**
 * Renderer-side `contextBridge`, with real context isolation. The preload runs in
 * a dedicated isolated JS world (`WKContentWorld 'BunmaskaPreload'` on macOS, the
 * `BunmaskaPreload` named world on Linux) that page scripts cannot see, so
 * `exposeInMainWorld` cannot just freeze `api` onto the isolated global — it
 * installs a cross-world host over a shared-`document` CustomEvent channel. That
 * channel's LIMITATIONS block in `cross-world-bridge.ts` is the security contract.
 */

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

/**
 * Create the `contextBridge`. Without an override it resolves the channel id,
 * `document`, and `CustomEvent` from the isolated world's globals, and creates the
 * host lazily on first `exposeInMainWorld` via {@link installCrossWorldHost}.
 */
export const createContextBridge = (override?: ContextBridgeTransport): ContextBridge => {
  let expose: ((key: string, api: Record<string, unknown>) => void) | undefined;
  return {
    exposeInMainWorld(key, api) {
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
        throw new BunmaskaError(error instanceof Error ? error.message : String(error));
      }
    },
  };
};

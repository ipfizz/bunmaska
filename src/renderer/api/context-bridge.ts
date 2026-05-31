import { SambarError } from '../../common/errors';
import {
  CHANNEL_GLOBAL_KEY,
  type CustomEventCtor,
  type EventScope,
  installCrossWorldHost,
} from './cross-world-bridge';

/**
 * Renderer-side `contextBridge` — the drop-in equivalent of Electron's, with
 * real context isolation.
 *
 * The preload (and this `contextBridge`) run in a dedicated isolated JS world
 * (`WKContentWorld 'SambarPreload'` on macOS; the `SambarPreload` named world on
 * Linux), invisible to page scripts. `exposeInMainWorld(key, api)` therefore
 * cannot just freeze `api` onto the isolated global — the page would never see
 * it. Instead it installs a cross-world host over a shared-`document`
 * CustomEvent channel: a page-world stub materialises `window[key]` whose async
 * methods dispatch request events the isolated host answers (see
 * `cross-world-bridge.ts`).
 *
 * LIMITATIONS (inherent to a DOM-event boundary in pure FFI — not bugs):
 *  - Exposed functions are ASYNC-ONLY: every page-side method returns a Promise.
 *  - Args/returns cross via structured clone (CustomEvent `detail`): NO
 *    functions/callbacks as arguments, NO live object references, data only.
 *  - Non-function `api` values are deep-cloned + frozen into the page object
 *    once at expose time; later isolated-side mutations are not reflected.
 *  - The DOM channel is page-observable (weaker than Electron's V8 boundary);
 *    the random channel id deters collisions, not a determined hostile page.
 */

export type ContextBridge = {
  exposeInMainWorld(key: string, api: Record<string, unknown>): void;
};

/** Injectable transport, overridable in tests. Defaults to the real DOM. */
export type ContextBridgeTransport = {
  /** Per-window random channel id shared with the page-world stub. */
  readonly channelId: string;
  /** The shared `document` both worlds dispatch events on. */
  readonly scope: EventScope;
  /** The DOM `CustomEvent` constructor. */
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
 * Create the `contextBridge`. Pass a {@link ContextBridgeTransport} to drive it
 * over a mock document in tests; in a real renderer it auto-resolves the channel
 * id, `document`, and `CustomEvent` from the isolated world's globals.
 *
 * The host is created lazily on first `exposeInMainWorld` by running the
 * canonical {@link installCrossWorldHost} (the same baked protocol source that is
 * injected into the isolated world), so this typed surface and the injected
 * runtime path share one implementation.
 */
export const createContextBridge = (override?: ContextBridgeTransport): ContextBridge => {
  let expose: ((key: string, api: Record<string, unknown>) => void) | undefined;
  return {
    exposeInMainWorld(key, api) {
      if (expose === undefined) {
        const transport = resolveTransport(override);
        if (transport === undefined) {
          throw new SambarError(
            'contextBridge: no cross-world channel is available; exposeInMainWorld must run in the Sambar isolated preload world',
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
        throw new SambarError(error instanceof Error ? error.message : String(error));
      }
    },
  };
};

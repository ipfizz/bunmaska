import {
  generateChannelId,
  generateIsolatedChannelSetup,
  generateIsolatedHostSource,
  generatePageWorldStub,
} from '../../renderer/api/cross-world-bridge';
import { generatePreloadBootstrap } from '../../renderer/preload-bootstrap';
import { generateDomReadyScript } from './dom-ready';
import { windowControlsScript } from './window-controls';

/** The isolated-world handler the preload bridge posts envelopes to. */
export const IPC_HANDLER_NAME = 'bunmaska';

/** The page-world handler the `executeJavaScript` wrapper posts its result to (D022b). */
export const EXEC_HANDLER_NAME = 'bunmaskaExec';

/** The isolated world (Electron `contextIsolation`) the bridge and user preload run in. */
export const PRELOAD_WORLD_NAME = 'BunmaskaPreload';

/** Delivers an envelope to the isolated-world bridge; a no-op until the bridge exists. */
export const dispatchScript = (envelopeJson: string): string =>
  `window.__bunmaska && window.__bunmaska._dispatch(${JSON.stringify(envelopeJson)});`;

export type InjectedScriptOptions = {
  readonly preloadScript?: string | undefined;
  readonly frame?: boolean | undefined;
  /** The world whose `dom-ready` handler the backend registered. */
  readonly domReadyWorld: 'isolated' | 'page';
  /** Only where the page world IS the bridge world (Windows), see {@link windowControlsScript}. */
  readonly nativeOpChannel?: boolean;
};

/**
 * Every backend's document-start scripts per world, each list in injection order; a
 * single-world backend injects `isolated` then `page`. The order is a security contract:
 * the contextBridge host must install `exposeInMainWorld` before the user preload runs.
 */
export const injectedScripts = (
  options: InjectedScriptOptions,
): { readonly isolated: string[]; readonly page: string[] } => {
  const channelId = generateChannelId();
  const domReady = generateDomReadyScript();
  return {
    isolated: [
      generateIsolatedChannelSetup(channelId),
      generatePreloadBootstrap(),
      generateIsolatedHostSource(channelId),
      ...(options.preloadScript !== undefined ? [options.preloadScript] : []),
      ...(options.domReadyWorld === 'isolated' ? [domReady] : []),
    ],
    // Where the page world is separate, never put __bunmaska in it: that defeats context isolation.
    page: [
      generatePageWorldStub(channelId),
      // Electron ignores drag regions in a framed window, so only a frameless one pays for the scan.
      // ponytail: --app-region mirror only off Windows; window-op controls wait for the isolated bridge (D045)
      ...(options.frame === false
        ? [windowControlsScript({ nativeOpChannel: options.nativeOpChannel === true })]
        : []),
      ...(options.domReadyWorld === 'page' ? [domReady] : []),
    ],
  };
};

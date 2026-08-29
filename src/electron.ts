import * as bunmaska from './index';
import { isImplemented, KNOWN_ELECTRON_MODULES, notImplementedMessage } from './main/module-list';

/**
 * The drop-in `electron` compatibility surface (REQUIREMENTS §8). A KNOWN-but-not-
 * yet-implemented module name (e.g. `electron.autoUpdater`) throws
 * {@link notImplementedMessage}; an unknown name still returns `undefined`.
 */

const KNOWN: ReadonlySet<string> = new Set(KNOWN_ELECTRON_MODULES);

/** Wrap `base` so unimplemented Electron module names throw on access. */
export const createElectronShim = (
  base: Record<string, unknown> = bunmaska as unknown as Record<string, unknown>,
): Record<string, unknown> =>
  new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && KNOWN.has(prop) && !isImplemented(prop)) {
        throw new Error(notImplementedMessage(prop));
      }
      return Reflect.get(target, prop, receiver);
    },
  });

const electron = createElectronShim();
export default electron;

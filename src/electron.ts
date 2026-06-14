import * as bunmaska from './index';
import { isImplemented, KNOWN_ELECTRON_MODULES, notImplementedMessage } from './main/module-list';

/**
 * The drop-in `electron` compatibility surface (REQUIREMENTS §8).
 *
 * Re-exports every Bunmaska module under Electron's names and wraps them in a
 * Proxy so that reaching for a KNOWN-but-not-yet-implemented Electron module
 * (e.g. `electron.autoUpdater`) throws the actionable {@link notImplementedMessage}
 * instead of returning `undefined`. An unknown name still returns `undefined`
 * (matching a plain object). Consumers alias `electron` → `bunmaska` so
 * `require('electron')` resolves here.
 */

const KNOWN: ReadonlySet<string> = new Set(KNOWN_ELECTRON_MODULES);

/**
 * Wrap `base` (the Bunmaska module surface) so unimplemented Electron module names
 * throw an actionable error on access. Injectable for testing.
 */
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

/** The Electron-compatible module surface. */
const electron = createElectronShim();
export default electron;

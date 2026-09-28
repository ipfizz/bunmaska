import * as bunmaska from './index';
import { isImplemented, KNOWN_ELECTRON_MODULES, notImplementedMessage } from './main/module-list';

const KNOWN: ReadonlySet<string> = new Set(KNOWN_ELECTRON_MODULES);

/** The drop-in `electron` surface (D032): a known-but-unimplemented module name throws, an unknown one is `undefined`. */
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

// Named imports of an unimplemented module fail at ESM link time with a generic
// error; only the default export's Proxy turns the access into notImplementedMessage.
export * from './index';

const electron = createElectronShim() as typeof bunmaska;
export default electron;

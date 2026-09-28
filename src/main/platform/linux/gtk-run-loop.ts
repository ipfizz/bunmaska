import { loadGlibFFI } from './glib-ffi';
import { pollX11ShortcutsOnce } from './x11-global-shortcut';

const NULL_CONTEXT = null;
// Never block: the pump shares Bun's only thread (D020).
const MAY_BLOCK_FALSE = 0;

/** Upper bound on inner iterations per tick, so a busy GLib loop cannot starve Bun's event loop. */
const DRAIN_BUDGET = 256;

/** The {@link CooperativePump} drain for GTK/GLib; throws off Linux (via the loader). */
export const createLinuxDrain = (): (() => void) => {
  const glib = loadGlibFFI();
  return () => {
    for (let i = 0; i < DRAIN_BUDGET; i += 1) {
      if (glib.symbols.g_main_context_pending(NULL_CONTEXT) === 0) {
        break;
      }
      glib.symbols.g_main_context_iteration(NULL_CONTEXT, MAY_BLOCK_FALSE);
    }
    // XGrabKey events arrive on their own X display connection, not GLib's context.
    pollX11ShortcutsOnce();
  };
};

import { loadGlibFFI } from './glib-ffi';
import { pollX11ShortcutsOnce } from './x11-global-shortcut';

/**
 * Linux native run-loop drain.
 *
 * The Linux analogue of the macOS CF drain (D020): the {@link CooperativePump}
 * calls this each tick to service GTK/GLib events without blocking Bun's thread.
 * We iterate the default main context while it reports pending sources, never
 * blocking (`may_block = FALSE`), bounded by a per-tick budget so a busy loop
 * cannot starve Bun's own event loop.
 *
 * The drain ALSO polls the dedicated X11 global-shortcut connection
 * ({@link pollX11ShortcutsOnce}) each tick: `XGrabKey` events arrive on their own
 * display connection, not GLib's main context, so they need their own poll. The
 * poll is a no-op until a global shortcut is registered.
 */

const NULL_CONTEXT = null;
const MAY_BLOCK_FALSE = 0;

/** Upper bound on inner iterations per tick. */
const DRAIN_BUDGET = 256;

/**
 * Create the Linux drain function. Throws {@link UnsupportedPlatformError} off
 * Linux (via the loader). Cheap to call repeatedly; never blocks.
 */
export const createLinuxDrain = (): (() => void) => {
  const glib = loadGlibFFI();
  return () => {
    for (let i = 0; i < DRAIN_BUDGET; i += 1) {
      if (glib.symbols.g_main_context_pending(NULL_CONTEXT) === 0) {
        break;
      }
      glib.symbols.g_main_context_iteration(NULL_CONTEXT, MAY_BLOCK_FALSE);
    }
    pollX11ShortcutsOnce();
  };
};

import { loadGtkFFI } from '../../src/main/platform/linux/gtk-ffi';

/** A Linux GTK test without a display fails loudly instead of passing with zero assertions. */
export const requireGtkDisplay = (): void => {
  if (loadGtkFFI().symbols.gtk_init_check() === 0) {
    throw new Error('gtk_init_check failed: no display (run under xvfb-run)');
  }
};

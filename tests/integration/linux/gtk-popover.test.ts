import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadGtkMenuFFI } from '../../../src/main/platform/linux/gtk-menu-ffi';

/**
 * The GtkPopoverMenu symbols behind `Menu.popup` on Linux resolve under xvfb. The full
 * popover-on-a-window round-trip is exercised by the app; the async popover never blocks the
 * pump (unlike the macOS blocking show), so symbol resolution is the CI-safe gate here.
 */
if (currentPlatform() === 'linux') {
  describe('GtkPopoverMenu symbols (Menu.popup)', () => {
    test('the popover + widget-parenting symbols resolve', () => {
      const menu = loadGtkMenuFFI();
      for (const name of [
        'gtk_popover_menu_new_from_model',
        'gtk_popover_set_pointing_to',
        'gtk_popover_popup',
        'gtk_popover_popdown',
        'gtk_widget_set_parent',
        'gtk_widget_unparent',
      ] as const) {
        expect(typeof menu.symbols[name]).toBe('function');
      }
    });
  });
}

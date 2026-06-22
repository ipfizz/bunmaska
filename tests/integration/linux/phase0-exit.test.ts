import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { cstr } from '../../../src/main/platform/cstr';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';

if (currentPlatform() === 'linux') {
  describe('Phase 0 Linux exit — drive GTK end-to-end from Bun via bun:ffi', () => {
    test('full window choreography: init + new + set_title + set_default_size + present', () => {
      const lib = loadGtkFFI();

      // 1. Initialize GTK 4. Under Xvfb (CI) this should return non-zero (TRUE).
      //    If running headless without Xvfb this returns 0 — assert only that
      //    the call returns a JS number so the test is informative either way.
      const initOk = lib.symbols.gtk_init_check();
      expect(typeof initOk).toBe('number');
      if (initOk === 0) {
        // No display — can't safely create widgets. The bootstrap test elsewhere
        // already proved FFI dispatch is wired up; we stop here.
        return;
      }

      // 2. Create a top-level window.
      const window = lib.symbols.gtk_window_new();
      expect(window).not.toBeNull();

      // 3. Title, size, present — the actual "open a window" choreography.
      lib.symbols.gtk_window_set_title(window, cstr('Bunmaska'));
      lib.symbols.gtk_window_set_default_size(window, 400, 300);
      lib.symbols.gtk_window_present(window);

      // The window object exists; presenting it scheduled it for display.
      // Visual rendering on Linux (running the GLib main loop) is deferred to
      // Phase 1 alongside the macOS run-loop integration (D019).
    });
  });
}

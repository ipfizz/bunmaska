import { dlopen, FFIType } from 'bun:ffi';
import { SambarError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

const LIBGTK_PATH = 'libgtk-4.so.1';

/**
 * Open `libgtk-4.so.1` and expose a minimal set of GTK 4 symbols for window
 * bootstrap. Mirrors {@link loadCocoaFFI}'s shape: platform-guarded, lazy,
 * throws on non-Linux so the module is safely importable on macOS for unit
 * testing.
 *
 * Initial symbol set is intentionally tiny — just enough to prove FFI dispatch
 * works. Additional GTK symbols are added per call site as needed (a deliberate
 * mirror of how the Cocoa side grew through Cycles 5-12).
 */
export const loadGtkFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new SambarError(
      `loadGtkFFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
  return dlopen(LIBGTK_PATH, {
    gtk_init_check: {
      args: [],
      returns: FFIType.i32,
    },
    gtk_window_new: {
      args: [],
      returns: FFIType.pointer,
    },
  });
};

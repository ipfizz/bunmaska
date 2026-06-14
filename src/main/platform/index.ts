import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import { createLinuxApplication } from './linux/linux-backend';
import { createMacOSApplication } from './macos/cocoa-backend';
import type { NativeApplication } from './native';

/**
 * The single runtime platform-selection point. Everything above `platform/`
 * obtains its native backend here and never imports a concrete backend
 * directly (D024). Windows is deferred (see WINDOWS.md).
 *
 * Both backends' FFI loaders are lazy: importing a backend module never opens a
 * shared object, so importing the Linux backend on macOS (and vice versa) is a
 * no-op until the matching `createXApplication()` actually drives the platform.
 */
export const createNativeApplication = (): NativeApplication => {
  const platform = currentPlatform();
  switch (platform) {
    case 'macos':
      return createMacOSApplication();
    case 'linux':
      return createLinuxApplication();
    default:
      throw new UnsupportedPlatformError(`No Bunmaska backend for platform: ${platform}`);
  }
};

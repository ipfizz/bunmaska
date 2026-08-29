import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import { createLinuxApplication } from './linux/linux-backend';
import { createMacOSApplication } from './macos/cocoa-backend';
import type { NativeApplication } from './native';
import { createWindowsApplication } from './windows/windows-backend';

/**
 * The single runtime platform-selection point; nothing above `platform/` imports a
 * concrete backend directly (D024). Every backend's FFI loaders are lazy, so
 * importing the Windows backend on macOS (and vice versa) opens no shared object.
 */
export const createNativeApplication = (): NativeApplication => {
  const platform = currentPlatform();
  switch (platform) {
    case 'macos':
      return createMacOSApplication();
    case 'linux':
      return createLinuxApplication();
    case 'windows':
      return createWindowsApplication();
    default:
      throw new UnsupportedPlatformError(`No Bunmaska backend for platform: ${platform}`);
  }
};

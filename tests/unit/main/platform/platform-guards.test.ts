import { describe, expect, test } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../src/common/errors';
import { currentPlatform, type Platform } from '../../../../src/common/platform';
import { createLinuxDrain } from '../../../../src/main/platform/linux/gtk-run-loop';
import { loadCocoaFFI } from '../../../../src/main/platform/macos/cocoa-ffi';
import { createMacOSDrain } from '../../../../src/main/platform/macos/cocoa-run-loop';
import { cocoa } from '../../../../src/main/platform/macos/cocoa-runtime';

/**
 * The native entry points guard at CALL time, not module load, so a cross-platform
 * import never explodes. Each one is checked from a host that is not its platform.
 */
const GUARDS: ReadonlyArray<{
  readonly name: string;
  readonly platform: Platform;
  readonly call: () => unknown;
}> = [
  { name: 'loadCocoaFFI', platform: 'macos', call: () => loadCocoaFFI() },
  { name: 'cocoa', platform: 'macos', call: () => cocoa() },
  { name: 'createMacOSDrain', platform: 'macos', call: () => createMacOSDrain() },
  { name: 'createLinuxDrain', platform: 'linux', call: () => createLinuxDrain() },
];

describe('native loaders off their own platform', () => {
  for (const { name, platform, call } of GUARDS) {
    test.skipIf(currentPlatform() === platform)(`${name} throws UnsupportedPlatformError`, () => {
      expect(call).toThrow(UnsupportedPlatformError);
    });
  }
});

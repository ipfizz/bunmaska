import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { currentPlatform } from '../../../src/common/platform';

const PLATFORM = join(import.meta.dir, '../../../src/main/platform');

if (currentPlatform() === 'macos') {
  describe('installCefApplicationClass', () => {
    test('turns an NSApp an early AppKit call already made into the CEF subclass', () => {
      // A fresh process: this suite already has a plain NSApp, and the swap must not leak into it.
      const script = `import { dlopen } from 'bun:ffi';
import { cocoa } from ${JSON.stringify(`${PLATFORM}/macos/cocoa-runtime.ts`)};
import { installCefApplicationClass } from ${JSON.stringify(`${PLATFORM}/cef/cef-runtime.ts`)};
const rt = cocoa();
const nsApp = () => rt.msgSend(rt.classes.get('NSApplication'), rt.selectors.get('sharedApplication'));
nsApp();
installCefApplicationClass();
const objc = dlopen('libobjc.A.dylib', { object_getClassName: { args: ['u64'], returns: 'cstring' } });
console.log(objc.symbols.object_getClassName(nsApp()));`;
      const proc = Bun.spawnSync([process.execPath, '-e', script], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(proc.stderr.toString()).toBe('');
      expect(proc.stdout.toString().trim()).toBe('BunmaskaCefApplication');
    });
  });
}

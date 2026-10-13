import { dlopen } from 'bun:ffi';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { currentPlatform } from '../../../src/common/platform';
import { cefGlue } from '../../../src/main/platform/cef/cef-glue';
import { mainBundlePath } from '../../../src/main/platform/cef/cef-runtime';

if (currentPlatform() === 'macos') {
  describe('CEF scratch files', () => {
    const saved = process.env['TMPDIR'];
    let tmp = '';

    beforeEach(() => {
      tmp = mkdtempSync(join(tmpdir(), 'bunmaska-cef-test-'));
      process.env['TMPDIR'] = tmp;
    });

    afterEach(() => {
      if (saved === undefined) {
        delete process.env['TMPDIR'];
      } else {
        process.env['TMPDIR'] = saved;
      }
      rmSync(tmp, { recursive: true, force: true });
    });

    test('the glue compiles from a private dir and leaves no shared file behind', () => {
      // TinyCC resolves the glue's CoreFoundation externs against the loaded images.
      dlopen('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation', {
        CFRunLoopGetMain: { args: [], returns: 'ptr' },
      });
      expect(cefGlue().slotGetter(0)).not.toBe(0);
      expect(readdirSync(tmp).filter((name) => name.startsWith('bunmaska'))).toEqual([]);
    });

    test('every launch gets its own dev bundle, in a dir no other user can open', () => {
      const first = mainBundlePath();
      expect(mainBundlePath()).not.toBe(first);
      expect(statSync(dirname(first)).mode & 0o077).toBe(0);
    });
  });
}

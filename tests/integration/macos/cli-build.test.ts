import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMacApp } from '../../../src/cli/build-macos';
import { currentPlatform } from '../../../src/common/platform';
import { BUNMASKA_VERSION } from '../../../src/common/version';

/**
 * Integration test for the macOS `.app` bundler. It writes a trivial entry
 * (not a real Bunmaska app — the bundler only packages it), compiles it with
 * `bun build --compile`, lays out the `.app`, then asserts the on-disk
 * structure. The produced binary is exec'd to confirm it actually runs.
 */
if (currentPlatform() === 'macos') {
  describe('buildMacApp (integration)', () => {
    let workDir: string;
    let entry: string;
    let outDir: string;
    const name = 'Hi App';

    beforeAll(() => {
      workDir = mkdtempSync(join(tmpdir(), 'bunmaska-cli-build-'));
      entry = join(workDir, 'entry.ts');
      outDir = join(workDir, 'out');
      writeFileSync(entry, "console.log('hi');\nprocess.exit(0);\n");
    });

    afterAll(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    test('produces a structurally valid .app from a trivial entry', async () => {
      const appPath = await buildMacApp({
        entry,
        name,
        id: 'com.example.hi',
        out: outDir,
      });

      expect(appPath).toBe(join(outDir, `${name}.app`));
      expect(existsSync(appPath)).toBe(true);

      const infoPlist = join(appPath, 'Contents', 'Info.plist');
      expect(existsSync(infoPlist)).toBe(true);
      const plistText = readFileSync(infoPlist, 'utf8');
      expect(plistText).toContain('<key>CFBundleIdentifier</key>');
      expect(plistText).toContain('com.example.hi');
      expect(plistText).toContain(name);
      expect(plistText).toContain(BUNMASKA_VERSION);

      const exe = join(appPath, 'Contents', 'MacOS', name);
      expect(existsSync(exe)).toBe(true);
      const mode = statSync(exe).mode;
      // Executable bit set for owner/group/other.
      expect(mode & 0o111).not.toBe(0);

      // The compiled binary should actually run and print 'hi'.
      const result = spawnSync(exe, [], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('hi');
    }, 30000);

    test('defaults the bundle id from the name when --id is omitted', async () => {
      const appPath = await buildMacApp({
        entry,
        name: 'Defaulted',
        out: join(workDir, 'out2'),
      });
      const plistText = readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8');
      expect(plistText).toContain('com.bunmaska.defaulted');
    }, 30000);
  });
}

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMacApp } from '../../../src/cli/build-macos';
import { currentPlatform } from '../../../src/common/platform';

/**
 * Integration test for the `.dmg` path of the macOS bundler. It builds a real
 * `.app` from a trivial entry with `--dmg`, then asserts a non-empty
 * `<Name>.dmg` is produced and that the REAL `hdiutil verify` passes
 * (exitCode 0) — a genuine on-host disk-image checksum verification. No volume
 * is mounted: `hdiutil create` + `verify` need none.
 */
if (currentPlatform() === 'macos') {
  describe('buildMacApp dmg creation (integration)', () => {
    let workDir: string;
    let entry: string;
    let outDir: string;
    let appPath: string;
    let dmgPath: string;
    const name = 'Dmg App';

    beforeAll(async () => {
      workDir = mkdtempSync(join(tmpdir(), 'bunmaska-cli-dmg-'));
      entry = join(workDir, 'entry.ts');
      outDir = join(workDir, 'out');
      writeFileSync(entry, "console.log('hi');\nprocess.exit(0);\n");
      appPath = await buildMacApp({
        entry,
        name,
        id: 'com.example.dmg',
        out: outDir,
        dmg: true,
      });
      dmgPath = join(outDir, `${name}.dmg`);
    }, 30000);

    afterAll(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    test('produced the .app bundle', () => {
      expect(appPath).toBe(join(outDir, `${name}.app`));
      expect(existsSync(appPath)).toBe(true);
    });

    test('produced a non-empty <Name>.dmg next to the .app', () => {
      expect(existsSync(dmgPath)).toBe(true);
      expect(statSync(dmgPath).size).toBeGreaterThan(0);
    });

    test('hdiutil verify passes on the produced .dmg (exitCode 0)', () => {
      const verify = spawnSync('hdiutil', ['verify', dmgPath], { encoding: 'utf8' });
      expect(verify.status).toBe(0);
    });
  });
}

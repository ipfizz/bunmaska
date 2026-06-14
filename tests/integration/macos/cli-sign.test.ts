import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMacApp } from '../../../src/cli/build-macos';
import { currentPlatform } from '../../../src/common/platform';

/**
 * Integration test for macOS code-signing. It builds a real `.app` from a
 * trivial entry, then signs it AD-HOC (`--sign -`), which needs NO certificate
 * and works on any Mac. It asserts the produced bundle passes the real
 * `codesign --verify --strict` and that `codesign --display` reports it signed.
 * This proves the signing path genuinely works on-host without a cert.
 */
if (currentPlatform() === 'macos') {
  describe('buildMacApp ad-hoc code-signing (integration)', () => {
    let workDir: string;
    let entry: string;
    let outDir: string;
    let appPath: string;
    const name = 'Signed App';

    beforeAll(async () => {
      workDir = mkdtempSync(join(tmpdir(), 'bunmaska-cli-sign-'));
      entry = join(workDir, 'entry.ts');
      outDir = join(workDir, 'out');
      writeFileSync(entry, "console.log('hi');\nprocess.exit(0);\n");
      appPath = await buildMacApp({
        entry,
        name,
        id: 'com.example.signed',
        out: outDir,
        sign: '-',
      });
    }, 30000);

    afterAll(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    test('produced the .app bundle', () => {
      expect(appPath).toBe(join(outDir, `${name}.app`));
      expect(existsSync(appPath)).toBe(true);
    });

    test('the ad-hoc-signed .app passes codesign --verify --strict (exitCode 0)', () => {
      const verify = spawnSync('codesign', ['--verify', '--strict', appPath], {
        encoding: 'utf8',
      });
      expect(verify.status).toBe(0);
    });

    test('codesign --display reports the bundle is signed', () => {
      const display = spawnSync('codesign', ['-dvv', '--display', appPath], {
        encoding: 'utf8',
      });
      expect(display.status).toBe(0);
      // codesign writes its details to stderr.
      const out = `${display.stdout}${display.stderr}`;
      expect(out).toContain('Identifier=');
      // Ad-hoc signatures report "Signature=adhoc".
      expect(out).toContain('adhoc');
    });
  });
}

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMacApp, convertPngToIcns } from '../../../src/cli/build-macos';
import { currentPlatform } from '../../../src/common/platform';
import { makeTinyPng } from '../../fixtures/tiny-png';

/**
 * Integration test for the PNG→.icns path of the macOS bundler. It generates a
 * real (tiny) PNG fixture, runs the actual `sips`/`iconutil` conversion via
 * `buildMacApp({ icon: <png> })`, and asserts the bundle holds a genuine
 * `.icns` (recognized by `file(1)`, round-trippable by `iconutil`, and carrying
 * the `icns` magic bytes), with `CFBundleIconFile` set in Info.plist. This
 * proves the conversion really works on-host, not that an opaque blob was copied.
 */
if (currentPlatform() === 'macos') {
  describe('buildMacApp PNG icon conversion (integration)', () => {
    let workDir: string;
    let entry: string;
    let outDir: string;
    let pngPath: string;
    let appPath: string;
    const name = 'Icon App';

    beforeAll(async () => {
      workDir = mkdtempSync(join(tmpdir(), 'bunmaska-cli-icon-'));
      entry = join(workDir, 'entry.ts');
      outDir = join(workDir, 'out');
      pngPath = join(workDir, 'logo.png');
      writeFileSync(entry, "console.log('hi');\nprocess.exit(0);\n");
      writeFileSync(pngPath, makeTinyPng());
      appPath = await buildMacApp({
        entry,
        name,
        id: 'com.example.icon',
        out: outDir,
        icon: pngPath,
      });
    }, 30000);

    afterAll(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    test('produced the .app bundle', () => {
      expect(appPath).toBe(join(outDir, `${name}.app`));
      expect(existsSync(appPath)).toBe(true);
    });

    test('placed a non-empty <Name>.icns in Contents/Resources', () => {
      const icnsPath = join(appPath, 'Contents', 'Resources', `${name}.icns`);
      expect(existsSync(icnsPath)).toBe(true);
      expect(statSync(icnsPath).size).toBeGreaterThan(0);
    });

    test('the produced file carries the icns magic bytes at offset 0', () => {
      const icnsPath = join(appPath, 'Contents', 'Resources', `${name}.icns`);
      const head = readFileSync(icnsPath).subarray(0, 4).toString('ascii');
      expect(head).toBe('icns');
    });

    test('file(1) recognizes the produced file as a Mac OS X icon', () => {
      const icnsPath = join(appPath, 'Contents', 'Resources', `${name}.icns`);
      const probed = spawnSync('file', ['-b', icnsPath], { encoding: 'utf8' });
      expect(probed.status).toBe(0);
      expect(probed.stdout).toContain('Mac OS X icon');
    });

    test('iconutil can round-trip the .icns back into an iconset (exitCode 0)', () => {
      const icnsPath = join(appPath, 'Contents', 'Resources', `${name}.icns`);
      const back = join(workDir, 'roundtrip.iconset');
      const converted = spawnSync('iconutil', ['-c', 'iconset', icnsPath, '-o', back], {
        encoding: 'utf8',
      });
      expect(converted.status).toBe(0);
      // A valid icns yields a non-empty iconset on extraction.
      expect(existsSync(join(back, 'icon_512x512@2x.png'))).toBe(true);
    });

    test('Info.plist sets CFBundleIconFile to the bundle name', () => {
      const plistText = readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8');
      expect(plistText).toContain('<key>CFBundleIconFile</key>');
      expect(plistText).toContain(`<key>CFBundleIconFile</key>\n  <string>${name}</string>`);
    });

    test('convertPngToIcns produces a standalone valid icns directly', async () => {
      const standalone = join(workDir, 'standalone.icns');
      await convertPngToIcns(pngPath, standalone);
      expect(existsSync(standalone)).toBe(true);
      const head = readFileSync(standalone).subarray(0, 4).toString('ascii');
      expect(head).toBe('icns');
    }, 30000);
  });
}

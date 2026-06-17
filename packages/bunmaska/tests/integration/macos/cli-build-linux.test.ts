import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLinuxApp } from '../../../src/cli/build-linux';
import { currentPlatform } from '../../../src/common/platform';

/**
 * Integration test for the Linux distributable builder, guarded to macOS so it
 * exercises Bun's `--target=bun-linux-x64` CROSS-compilation. It writes a
 * trivial entry, cross-compiles it, lays out the AppDir, and asserts the
 * compiled binary is a real Linux ELF (not a host Mach-O), the .desktop file is
 * correct, and the .tar.gz / .deb archives exist and list the expected members.
 */
if (currentPlatform() === 'macos') {
  describe('buildLinuxApp cross-compile (integration)', () => {
    let workDir: string;
    let outDir: string;
    const name = 'Test App';
    let result: { appDir: string; tarball: string; deb?: string };

    beforeAll(async () => {
      workDir = mkdtempSync(join(tmpdir(), 'bunmaska-cli-build-linux-'));
      outDir = join(workDir, 'out');
      const entry = join(workDir, 'entry.ts');
      Bun.write(entry, "console.log('hi');\nprocess.exit(0);\n");
      // Bun.write returns a promise; ensure it landed before compiling.
      await Bun.write(entry, "console.log('hi');\nprocess.exit(0);\n");
      result = await buildLinuxApp({
        entry,
        name,
        id: 'com.example.testapp',
        out: outDir,
      });
    }, 30000);

    afterAll(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    test('compiles the binary into usr/bin/<slug>', () => {
      const binPath = join(result.appDir, 'usr', 'bin', 'test-app');
      const info = statSync(binPath);
      expect(info.isFile()).toBe(true);
      expect(info.size).toBeGreaterThan(0);
      // Executable bit set.
      expect(info.mode & 0o111).not.toBe(0);
    });

    test('the compiled binary is a Linux ELF (magic 7f 45 4c 46)', () => {
      const binPath = join(result.appDir, 'usr', 'bin', 'test-app');
      const buf = readFileSync(binPath);
      expect(buf[0]).toBe(0x7f);
      expect(buf[1]).toBe(0x45); // 'E'
      expect(buf[2]).toBe(0x4c); // 'L'
      expect(buf[3]).toBe(0x46); // 'F'
    });

    test('writes a .desktop entry with the right Name and Exec', () => {
      const desktopPath = join(result.appDir, 'usr', 'share', 'applications', 'test-app.desktop');
      const text = readFileSync(desktopPath, 'utf8');
      expect(text).toContain('[Desktop Entry]');
      expect(text).toContain('Name=Test App');
      expect(text).toContain('Exec=test-app');
    });

    test('produces a non-empty .tar.gz listing the expected entries', () => {
      const info = statSync(result.tarball);
      expect(info.isFile()).toBe(true);
      expect(info.size).toBeGreaterThan(0);
      expect(result.tarball.endsWith('Test App-linux-x64.tar.gz')).toBe(true);

      const listing = spawnSync('tar', ['tzf', result.tarball], {
        encoding: 'utf8',
      });
      expect(listing.status).toBe(0);
      expect(listing.stdout).toContain('usr/bin/test-app');
      expect(listing.stdout).toContain('usr/share/applications/test-app.desktop');
    });

    test('produces a non-empty .deb whose ar members are debian-binary/control/data', () => {
      expect(result.deb).toBeDefined();
      const debPath = result.deb as string;
      const info = statSync(debPath);
      expect(info.isFile()).toBe(true);
      expect(info.size).toBeGreaterThan(0);

      const listing = spawnSync('ar', ['t', debPath], { encoding: 'utf8' });
      expect(listing.status).toBe(0);
      expect(listing.stdout).toContain('debian-binary');
      expect(listing.stdout).toContain('control.tar.gz');
      expect(listing.stdout).toContain('data.tar.gz');
    });
  });
}

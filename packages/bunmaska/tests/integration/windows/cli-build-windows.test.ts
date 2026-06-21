import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWindowsApp } from '../../../src/cli/build-windows';
import { currentPlatform } from '../../../src/common/platform';

/**
 * Integration test for the Windows distributable builder, guarded to a Windows
 * host so the produced `.exe` can actually be executed. It writes a trivial entry
 * (no WebKit — just print + exit), native-compiles it with Bun's
 * `--target=bun-windows-x64`, lays out the portable dir, and asserts the binary
 * is a real PE that runs, the engine-id is baked beside it, and the `.zip` is a
 * non-empty PKZIP archive. No engine is needed: the entry never loads WebKit.
 */
if (currentPlatform() === 'windows') {
  describe('buildWindowsApp (integration)', () => {
    let workDir: string;
    let outDir: string;
    const name = 'Test App';
    let result: { appDir: string; exePath: string; zip: string };

    beforeAll(async () => {
      workDir = mkdtempSync(join(tmpdir(), 'bunmaska-cli-build-windows-'));
      outDir = join(workDir, 'out');
      const entry = join(workDir, 'entry.ts');
      await Bun.write(entry, "process.stdout.write('BUILD_OK\\n');\nprocess.exit(0);\n");
      result = await buildWindowsApp({ entry, name, out: outDir });
    }, 120000);

    afterAll(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    test('compiles a non-empty <Name>.exe into the portable dir', () => {
      const info = statSync(result.exePath);
      expect(info.isFile()).toBe(true);
      expect(info.size).toBeGreaterThan(0);
      expect(result.exePath.endsWith(join('Test App', 'Test App.exe'))).toBe(true);
    });

    test('the compiled binary is a Windows PE (MZ magic)', () => {
      const buf = readFileSync(result.exePath);
      expect(buf[0]).toBe(0x4d); // 'M'
      expect(buf[1]).toBe(0x5a); // 'Z'
    });

    test('bakes engine.id (system by default) beside the executable', () => {
      const baked = readFileSync(join(result.appDir, 'engine.id'), 'utf8').trim();
      expect(baked).toBe('system');
    });

    test('the produced .exe runs and prints its marker', async () => {
      const proc = Bun.spawn([result.exePath], { stdout: 'pipe', stderr: 'pipe' });
      const stdout = await new Response(proc.stdout).text();
      const code = await proc.exited;
      expect(code).toBe(0);
      expect(stdout).toContain('BUILD_OK');
    }, 30000);

    test('produces a non-empty .zip (PKZIP magic) named <Name>-windows-x64.zip', () => {
      const info = statSync(result.zip);
      expect(info.isFile()).toBe(true);
      expect(info.size).toBeGreaterThan(0);
      expect(result.zip.endsWith('Test App-windows-x64.zip')).toBe(true);
      const buf = readFileSync(result.zip);
      expect(buf[0]).toBe(0x50); // 'P'
      expect(buf[1]).toBe(0x4b); // 'K'
    });
  });
}

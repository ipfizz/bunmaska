import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWindowsApp } from '../../../src/cli/build-windows';
import { currentPlatform } from '../../../src/common/platform';

/** PE optional-header Subsystem: 2 = GUI (no console window), 3 = console. */
const peSubsystem = (exe: Uint8Array): number => {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const peOffset = view.getUint32(0x3c, true);
  return view.getUint16(peOffset + 24 + 68, true);
};

describe('buildWindowsApp cross-compiled from macOS (integration)', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'bunmaska-cli-build-windows-cross-'));

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  test.skipIf(currentPlatform() !== 'macos')(
    'produces a GUI-subsystem .exe and its zip, replacing an earlier build',
    async () => {
      const entry = join(workDir, 'entry.ts');
      writeFileSync(entry, "console.log('hi');\n");
      const staleEngine = join(workDir, 'out', 'Cross App', 'webkit');
      mkdirSync(staleEngine, { recursive: true });
      writeFileSync(join(staleEngine, '..', 'engine.id'), 'system\n');

      const result = await buildWindowsApp({ entry, name: 'Cross App', out: join(workDir, 'out') });

      expect(peSubsystem(readFileSync(result.exePath))).toBe(2);
      expect(readFileSync(result.zip).subarray(0, 2).toString()).toBe('PK');
      expect(existsSync(staleEngine)).toBe(false);
    },
    120000,
  );
});

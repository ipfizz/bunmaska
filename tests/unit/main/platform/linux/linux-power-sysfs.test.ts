import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { readSysfsOnBattery } from '../../../../../src/main/platform/linux/linux-power-monitor';

const supply = (dir: string, name: string, files: Record<string, string>): void => {
  const path = join(dir, name);
  mkdirSync(path);
  for (const [file, value] of Object.entries(files)) {
    writeFileSync(join(path, file), `${value}\n`);
  }
};

describe('readSysfsOnBattery', () => {
  test('false when an AC adapter is online', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bunmaska-ps-'));
    supply(dir, 'AC', { type: 'Mains', online: '1' });
    supply(dir, 'BAT0', { type: 'Battery', status: 'Charging' });
    expect(readSysfsOnBattery(dir)).toBe(false);
  });

  test('true when AC is offline and a battery is discharging', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bunmaska-ps-'));
    supply(dir, 'AC', { type: 'Mains', online: '0' });
    supply(dir, 'BAT0', { type: 'Battery', status: 'Discharging' });
    expect(readSysfsOnBattery(dir)).toBe(true);
  });

  test('false when the directory is missing', () => {
    expect(readSysfsOnBattery(join(tmpdir(), 'bunmaska-no-such-ps'))).toBe(false);
  });
});

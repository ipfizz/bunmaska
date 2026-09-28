import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateSealedKey } from '../../../../../src/main/platform/windows/windows-safe-storage';

const identity = (bytes: Uint8Array): Uint8Array => bytes;

describe('loadOrCreateSealedKey', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('creates a 32-byte key on first use and reads the same key back', () => {
    dir = mkdtempSync(join(tmpdir(), 'bunmaska-key-'));
    const path = join(dir, 'home', 'safestorage.key');
    const first = loadOrCreateSealedKey(path, identity, identity);
    expect(first).toHaveLength(32);
    expect(loadOrCreateSealedKey(path, identity, identity)).toEqual(first);
  });

  test('adopts the key a concurrent first run stored, leaving no temp file behind', () => {
    dir = mkdtempSync(join(tmpdir(), 'bunmaska-key-'));
    const path = join(dir, 'safestorage.key');
    const winner = Buffer.alloc(32, 7);
    // Another process lands its key while this one is still sealing its own.
    const racingSeal = (key: Uint8Array): Uint8Array => {
      writeFileSync(path, winner);
      return key;
    };
    expect(loadOrCreateSealedKey(path, racingSeal, identity)).toEqual(winner);
    expect(readFileSync(path)).toEqual(winner);
    expect(readdirSync(dir)).toEqual(['safestorage.key']);
  });
});

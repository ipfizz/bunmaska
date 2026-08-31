import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRIVATE_KEY_FILE, PUBLIC_KEY_FILE, runKeygen } from '../../../src/cli/keygen';
import { signArtifact, verifyArtifact } from '../../../src/common/signature';

const tmpDirs: string[] = [];
const makeTmpDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'bunmaska-keygen-'));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

type Capture = { out: string[]; err: string[] };
const io = (): Capture & { out: string[]; err: string[] } => ({ out: [], err: [] });
const asIo = (c: Capture): Parameters<typeof runKeygen>[1] => ({
  out: (text) => c.out.push(text),
  err: (text) => c.err.push(text),
});

describe('bunmaska keygen', () => {
  test('writes a working Ed25519 pair and prints paths plus usage guidance', () => {
    const dir = makeTmpDir();
    const c = io();
    const code = runKeygen(dir, asIo(c));
    expect(code).toBe(0);
    const privatePem = readFileSync(join(dir, PRIVATE_KEY_FILE), 'utf8');
    const publicPem = readFileSync(join(dir, PUBLIC_KEY_FILE), 'utf8');
    // The pair round-trips through the exact primitives build + autoUpdater use.
    const sig = signArtifact(privatePem, new Uint8Array([1, 2, 3]));
    expect(verifyArtifact(publicPem, new Uint8Array([1, 2, 3]), sig)).toBe(true);
    const printed = c.out.join('\n');
    expect(printed).toContain(join(dir, PRIVATE_KEY_FILE));
    expect(printed).toContain(join(dir, PUBLIC_KEY_FILE));
    expect(printed).toContain('setFeedURL');
    expect(printed.toLowerCase()).toContain('never ship');
  });

  test('refuses to overwrite an existing key file', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, PRIVATE_KEY_FILE), 'existing');
    const c = io();
    const code = runKeygen(dir, asIo(c));
    expect(code).toBe(1);
    expect(c.err.join('\n')).toContain('refusing to overwrite');
    // The existing file is untouched and no public half was written.
    expect(readFileSync(join(dir, PRIVATE_KEY_FILE), 'utf8')).toBe('existing');
    expect(existsSync(join(dir, PUBLIC_KEY_FILE))).toBe(false);
  });
});

test('creates the output directory when it does not exist', () => {
  // keygen --out keys crashed with ENOENT before mkdir was added.
  const dir = mkdtempSync(join(tmpdir(), 'bunmaska-keygen-'));
  const nested = join(dir, 'brand', 'new');
  const code = runKeygen(nested, { out: () => undefined, err: () => undefined });
  expect(code).toBe(0);
  expect(existsSync(join(nested, PRIVATE_KEY_FILE))).toBe(true);
});

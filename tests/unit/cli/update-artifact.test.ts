import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentHash, parseUpdateManifest } from '../../../src/common/manifest';
import {
  buildUpdateManifest,
  emitUpdateArtifact,
  type UpdateArtifactSpec,
} from '../../../src/cli/update-artifact';

const tmpDirs: string[] = [];
const makeTmpDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'sambar-artifact-'));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const spec = (outDir: string, bundlePath: string): UpdateArtifactSpec => ({
  bundlePath,
  outDir,
  name: 'My App',
  version: '2.1.0',
  channel: 'stable',
  os: 'macos',
  arch: 'arm64',
});

describe('buildUpdateManifest', () => {
  test('describes the artifact with its hash, size, and flat name', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const manifest = buildUpdateManifest(spec('/out', '/build/My App.app'), bytes);
    expect(manifest).toEqual({
      name: 'My App',
      version: '2.1.0',
      channel: 'stable',
      os: 'macos',
      arch: 'arm64',
      hash: contentHash(bytes),
      size: 4,
      artifact: 'my-app-stable-macos-arm64.tar.zst',
    });
  });
});

describe('emitUpdateArtifact (injected seams)', () => {
  test('compresses the bundle and writes a matching update.json', async () => {
    const artifactBytes = new Uint8Array([9, 8, 7, 6, 5]);
    const writes = new Map<string, string>();
    const result = await emitUpdateArtifact(spec('/out', '/build/My App.app'), {
      tarZst: async (_bundle, outPath) => {
        expect(outPath).toBe('/out/my-app-stable-macos-arm64.tar.zst');
      },
      readBytes: () => artifactBytes,
      writeText: (path, text) => writes.set(path, text),
    });
    expect(result.artifactPath).toBe('/out/my-app-stable-macos-arm64.tar.zst');
    expect(result.manifestPath).toBe('/out/update.json');
    expect(result.manifest.hash).toBe(contentHash(artifactBytes));
    // The written update.json round-trips back to the same manifest.
    expect(parseUpdateManifest(writes.get('/out/update.json') ?? '')).toEqual(result.manifest);
  });
});

describe('emitUpdateArtifact (real tar + zstd)', () => {
  test('produces a .tar.zst + update.json whose hash verifies', async () => {
    const root = makeTmpDir();
    const bundle = join(root, 'Demo.app');
    mkdirSync(bundle, { recursive: true });
    writeFileSync(join(bundle, 'payload.txt'), 'hello sambar update');
    const outDir = join(root, 'out');
    mkdirSync(outDir);

    const result = await emitUpdateArtifact({
      bundlePath: bundle,
      outDir,
      name: 'Demo',
      version: '1.2.3',
      channel: 'stable',
      os: 'macos',
      arch: 'arm64',
    });

    expect(existsSync(result.artifactPath)).toBe(true);
    expect(existsSync(result.manifestPath)).toBe(true);
    // The on-disk artifact's hash + size match what update.json claims.
    const bytes = readFileSync(result.artifactPath);
    expect(result.manifest.size).toBe(bytes.length);
    expect(result.manifest.hash).toBe(contentHash(bytes));
    expect(result.manifest.artifact).toBe('demo-stable-macos-arm64.tar.zst');
    // No stray uncompressed .tar left behind.
    expect(existsSync(result.artifactPath.replace(/\.zst$/, ''))).toBe(false);
  });
});

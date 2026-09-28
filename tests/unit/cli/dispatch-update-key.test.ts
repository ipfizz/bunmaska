import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatch } from '../../../src/cli/index';
import { runKeygen } from '../../../src/cli/keygen';
import { currentArch } from '../../../src/common/platform';
import { verifyArtifact } from '../../../src/common/signature';

/** The builder is stubbed to a real mini bundle so emitUpdateArtifact runs for real. */
const ARTIFACT = `demo-stable-linux-${currentArch()}.tar.zst`;

const originalCwd = process.cwd();
let dir: string | undefined;
afterEach(() => {
  process.chdir(originalCwd);
  if (dir !== undefined) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

type Streams = { out: string[]; err: string[] };

/** Capture process.stdout/stderr writes for the duration of `fn`. */
const captured = async (fn: () => Promise<void>): Promise<Streams> => {
  const out: string[] = [];
  const err: string[] = [];
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
  return { out, err };
};

const setupProject = (): { root: string; bundle: string } => {
  const root = mkdtempSync(join(tmpdir(), 'bunmaska-update-key-'));
  dir = root;
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  writeFileSync(join(root, 'app.ts'), '');
  const bundle = join(root, 'Demo');
  mkdirSync(bundle);
  writeFileSync(join(bundle, 'payload.txt'), 'update me');
  process.chdir(root);
  return { root, bundle };
};

describe('dispatch build --update signing', () => {
  test('without --update-key it loudly warns the feed is unsigned', async () => {
    const { root, bundle } = setupProject();
    let code = -1;
    const streams = await captured(async () => {
      code = await dispatch(
        {
          kind: 'build',
          entry: 'app.ts',
          options: { target: 'linux', name: 'Demo', update: true },
        },
        { buildLinux: async () => ({ appDir: bundle, tarball: '', deb: '' }) },
      );
    });
    expect(code).toBe(0);
    const stderr = streams.err.join('');
    expect(stderr).toContain('UNSIGNED');
    expect(stderr).toContain('--update-key');
    expect(existsSync(join(root, `${ARTIFACT}.sig`))).toBe(false);
  });

  test('with --update-key it writes a .sig the public key verifies and prints its path', async () => {
    const { root, bundle } = setupProject();
    const keysDir = join(root, 'keys');
    mkdirSync(keysDir);
    runKeygen(keysDir, { out: () => undefined, err: () => undefined });
    let code = -1;
    const streams = await captured(async () => {
      code = await dispatch(
        {
          kind: 'build',
          entry: 'app.ts',
          options: {
            target: 'linux',
            name: 'Demo',
            update: true,
            updateKey: join(keysDir, 'update-signing-key.pem'),
          },
        },
        { buildLinux: async () => ({ appDir: bundle, tarball: '', deb: '' }) },
      );
    });
    expect(code).toBe(0);
    const sigPath = join(root, `${ARTIFACT}.sig`);
    expect(streams.out.join('')).toContain(sigPath);
    expect(streams.err.join('')).not.toContain('UNSIGNED');
    const artifact = readFileSync(join(root, ARTIFACT));
    const publicPem = readFileSync(join(keysDir, 'update-public-key.pem'), 'utf8');
    const sig = readFileSync(sigPath, 'utf8').trim();
    expect(verifyArtifact(publicPem, artifact, sig)).toBe(true);
  });
});

describe('dispatch build --update manifest', () => {
  test('a Windows feed is labelled x64 whatever the host arch', async () => {
    const { root, bundle } = setupProject();
    let code = -1;
    await captured(async () => {
      code = await dispatch(
        {
          kind: 'build',
          entry: 'app.ts',
          options: { target: 'windows', name: 'Demo', update: true },
        },
        { buildWindows: async () => ({ appDir: bundle, exePath: '', zip: '' }) },
      );
    });
    expect(code).toBe(0);
    const manifest = JSON.parse(readFileSync(join(root, 'update.json'), 'utf8'));
    expect(manifest.arch).toBe('x64');
    expect(existsSync(join(root, 'demo-stable-windows-x64.tar.zst'))).toBe(true);
  });
});

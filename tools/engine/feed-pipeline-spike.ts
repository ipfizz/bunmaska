/**
 * Prove the "engine on our CDN" model end-to-end WITHOUT a real CDN: pack a store
 * engine into <id>.tar.zst, sign it (Ed25519), publish a 3-file feed in memory,
 * then run the REAL consumer (installFromUrl) which fetches + verifies the
 * signature + verifies the content hash + extracts + installs into a fresh store.
 * The fetch seam reads the in-memory feed, so every byte of the real verify path
 * runs. Env: STAGING (engine dir w/ lib + engine.json), TEST_STORE (fresh root).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateSigningKeyPair, signArtifact } from '../../src/cli/engine-signature';
import { contentHash } from '../../src/common/manifest';
import { installFromUrl } from '../../src/cli/engine-remote';
import { verifyEngine } from '../../src/cli/engine-store';

const STAGING = process.env.STAGING ?? '';
const STORE = process.env.TEST_STORE ?? '';
const ID = 'webkit-2-2311.0.0-bunmaska1-windows-x64';

// 1. PACK: tar (lib + engine.json) -> zstd, exactly what zstdTarExtract reverses.
const tar = Bun.spawnSync(['tar', '-cf', '-', '-C', STAGING, 'lib', 'engine.json']);
if (tar.exitCode !== 0) {
  process.stdout.write(`FEED_PIPELINE_FAIL tar: ${tar.stderr.toString()}\n`);
  process.exit(1);
}
const zst = Bun.zstdCompressSync(tar.stdout);
const hash = contentHash(zst);
process.stdout.write(`packed: tar=${tar.stdout.length}B  zst=${zst.length}B  sha=${hash.slice(0, 16)}…\n`);

// 2. SIGN with a freshly generated release keypair (the real one stays secret).
const { publicKey, privateKey } = generateSigningKeyPair();
const sig = signArtifact(privateKey, zst);
const manifest = JSON.stringify({ id: ID, hash, size: zst.length, soname: 'WebKit2.dll' });

// 3. PUBLISH a 3-file feed (the R2 layout) in memory, read via the fetch seam.
const base = `https://engines.bunmaska.org/${ID}.tar.zst`;
const feed: Record<string, Uint8Array> = {
  [base]: zst,
  [`${base}.json`]: new TextEncoder().encode(manifest),
  [`${base}.sig`]: new TextEncoder().encode(sig),
};
const fetchFromFeed = async (url: string): Promise<Uint8Array> => {
  const bytes = feed[url];
  if (bytes === undefined) throw new Error(`feed 404: ${url}`);
  return bytes;
};

// 4. CONSUME: the real installFromUrl — verifies sig + hash, extracts, marks.
// Windows fix (candidate for engine-remote.ts): bsdtar mangles a backslash `-C <dir>`,
// so run tar with cwd:destDir instead of passing the path as an arg.
const extract = async (bytes: Uint8Array, destDir: string): Promise<void> => {
  const tarBytes = Bun.zstdDecompressSync(bytes);
  const proc = Bun.spawn(['tar', '-xf', '-'], {
    cwd: destDir,
    stdin: tarBytes,
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`extract: ${await new Response(proc.stderr).text()}`);
};
const res = await installFromUrl(STORE, base, publicKey, { fetch: fetchFromFeed, extract });
process.stdout.write(`INSTALL ${JSON.stringify(res)}\n`);

// 5. Structural proof the fetched engine landed correctly.
const v = verifyEngine(STORE, ID);
const dllOk = existsSync(join(STORE, ID, 'lib', 'WebKit2.dll'));
process.stdout.write(`VERIFY ${v.ok ? 'ok' : `FAIL ${v.problems.join('; ')}`}\n`);
process.stdout.write(
  dllOk && v.ok
    ? 'FEED_PIPELINE_OK signed artifact fetched, verified, installed, WebKit2.dll present\n'
    : 'FEED_PIPELINE_FAIL\n',
);

/**
 * Pack a built engine directory into the 3-file signed feed layout that
 * `bunmaska engine install <url>` consumes: `<id>.tar.zst` + `<id>.tar.zst.json`
 * (the remote manifest: id/hash/size/soname) + `<id>.tar.zst.sig` (detached
 * base64 Ed25519 over the artifact bytes). The output dir mirrors the feed root
 * one-to-one, so publishing is a plain object upload (R2/S3/any static host).
 *
 *   bun tools/engine/pack-engine.ts <engineDir> <outDir> <privateKeyPemFile>
 *
 * `<engineDir>` is a store-shaped engine (lib/ + engine.json), e.g. the output
 * of build-wincairo-windows.ps1 / build-webkitgtk-linux.sh.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { packEngineDir } from '../../src/cli/engine-pack';

const [engineDir, outDir, keyFile] = process.argv.slice(2);
if (!engineDir || !outDir || !keyFile) {
  process.stderr.write('usage: bun tools/engine/pack-engine.ts <engineDir> <outDir> <privateKeyPemFile>\n');
  process.exit(2);
}

const privateKeyPem = readFileSync(keyFile, 'utf8');
const packed = await packEngineDir(engineDir, privateKeyPem);

mkdirSync(outDir, { recursive: true });
const base = join(outDir, `${packed.manifest.id}.tar.zst`);
writeFileSync(base, packed.artifact);
writeFileSync(`${base}.json`, JSON.stringify(packed.manifest));
writeFileSync(`${base}.sig`, packed.signature);

const mb = (n: number): string => (n / (1024 * 1024)).toFixed(1);
process.stdout.write(
  `packed ${packed.manifest.id}\n` +
    `  artifact: ${basename(base)}  ${mb(packed.manifest.size)} MB (tar ${mb(packed.tarSize)} MB, zstd level ${packed.level})\n` +
    `  hash:     ${packed.manifest.hash}\n` +
    `  feed dir: ${outDir}\n`,
);

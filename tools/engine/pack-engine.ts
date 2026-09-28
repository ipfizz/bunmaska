// bun tools/engine/pack-engine.ts <engineDir> <outDir> <privateKeyPemFile>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { packEngineDir } from '../../src/cli/engine-pack';

const [engineDir, outDir, keyFile] = process.argv.slice(2);
if (!engineDir || !outDir || !keyFile) {
  process.stderr.write(
    'usage: bun tools/engine/pack-engine.ts <engineDir> <outDir> <privateKeyPemFile>\n',
  );
  process.exit(2);
}

const privateKeyPem = readFileSync(keyFile, 'utf8');
const packed = await packEngineDir(engineDir, privateKeyPem);

mkdirSync(outDir, { recursive: true });
const base = join(outDir, `${packed.manifest.id}.tar.zst`);
writeFileSync(base, packed.artifact);
writeFileSync(`${base}.json`, JSON.stringify(packed.manifest));
writeFileSync(`${base}.sig`, packed.signature);

const mb = (n: number | undefined): string => ((n ?? 0) / (1024 * 1024)).toFixed(1);
process.stdout.write(
  `packed ${packed.manifest.id}\n` +
    `  artifact: ${basename(base)}  ${mb(packed.manifest.size)} MB\n` +
    `  hash:     ${packed.manifest.hash}\n` +
    `  feed dir: ${outDir}\n`,
);

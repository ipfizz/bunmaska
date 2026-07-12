/**
 * Build the feed `index.json` (the published list of available engines) from one
 * or more packed feed dirs / manifest files. Each engine's `<id>.tar.zst.json`
 * manifest already carries id/hash/size/soname; this collects them into the
 * single `index.json` that `bunmaska engine available` reads and that the docs
 * point at. Upload it to the feed root beside the engines.
 *
 *   bun tools/engine/build-index.ts <out/index.json> <manifest.json...>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildEngineIndex } from '../../src/cli/engine-index';
import { parseRemoteManifest } from '../../src/cli/engine-remote';

const [out, ...manifests] = process.argv.slice(2);
if (!out || manifests.length === 0) {
  process.stderr.write('usage: bun tools/engine/build-index.ts <out/index.json> <manifest.json...>\n');
  process.exit(2);
}

const entries = manifests.map((path) => {
  const m = parseRemoteManifest(readFileSync(path, 'utf8'));
  return {
    id: m.id,
    ...(m.size !== undefined ? { size: m.size } : {}),
    hash: m.hash,
    ...(m.soname !== undefined ? { soname: m.soname } : {}),
  };
});

writeFileSync(out, buildEngineIndex(entries));
process.stdout.write(`wrote ${out} with ${entries.length} engine(s):\n`);
for (const e of entries) process.stdout.write(`  ${e.id}\n`);

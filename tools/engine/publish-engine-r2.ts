/**
 * Publish a packed engine feed directory (the 3 files produced by
 * `pack-engine.ts`: `<id>.tar.zst` + `.json` + `.sig`) to a Cloudflare R2 bucket
 * via wrangler, then refresh the bucket's `index.json` (fetched from R2 itself,
 * merged, re-uploaded) so `bunmaska engine available` lists the new engine. The
 * bucket is served at the feed base (`engines.bunmaska.org`), so this is the
 * entire "go live" step — the client (`bunmaska engine install <id>`) then
 * fetches + verifies them.
 *
 *   bun tools/engine/publish-engine-r2.ts <feedDir> <engineId> [--bucket <name>]
 *
 * Requires wrangler auth in the environment (CLOUDFLARE_API_TOKEN +
 * CLOUDFLARE_ACCOUNT_ID with R2 write on the bucket). Idempotent per object.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeEngineIndex } from '../../src/cli/engine-index';
import { parseRemoteManifest } from '../../src/cli/engine-remote';

const args = process.argv.slice(2);
const feedDir = args[0];
const engineId = args[1];
const bucketFlag = args.indexOf('--bucket');
const bucket = bucketFlag >= 0 ? args[bucketFlag + 1] : 'bunmaska-engines';

if (!feedDir || !engineId) {
  process.stderr.write(
    'usage: bun tools/engine/publish-engine-r2.ts <feedDir> <engineId> [--bucket <name>]\n',
  );
  process.exit(2);
}

const wrangler = (...cmd: string[]): number =>
  Bun.spawnSync(['bunx', 'wrangler@4', 'r2', 'object', ...cmd, '--remote'], {
    stdout: 'inherit',
    stderr: 'inherit',
  }).exitCode;

const files = [`${engineId}.tar.zst`, `${engineId}.tar.zst.json`, `${engineId}.tar.zst.sig`];
for (const name of files) {
  const path = join(feedDir, name);
  if (!existsSync(path)) {
    process.stderr.write(`missing feed file: ${path}\n`);
    process.exit(1);
  }
}

for (const name of files) {
  const path = join(feedDir, name);
  process.stdout.write(`uploading ${name} -> r2://${bucket}/${name}\n`);
  if (wrangler('put', `${bucket}/${name}`, '--file', path) !== 0) {
    process.stderr.write(`wrangler put failed for ${name}\n`);
    process.exit(1);
  }
}

// Refresh index.json: read the CURRENT one from the bucket (not the CDN — no
// cache staleness, works for any bucket), merge this engine in, upload back.
// A missing index (first publish) just starts a new one.
const work = mkdtempSync(join(tmpdir(), 'bunmaska-index-'));
const current = join(work, 'index-current.json');
const merged = join(work, 'index.json');
const hadIndex = wrangler('get', `${bucket}/index.json`, '--file', current) === 0;
const manifest = parseRemoteManifest(readFileSync(join(feedDir, `${engineId}.tar.zst.json`), 'utf8'));
writeFileSync(
  merged,
  mergeEngineIndex(hadIndex ? readFileSync(current, 'utf8') : undefined, manifest),
);
process.stdout.write(`updating index.json (${hadIndex ? 'merged into existing' : 'new index'})\n`);
if (wrangler('put', `${bucket}/index.json`, '--file', merged) !== 0) {
  process.stderr.write('wrangler put failed for index.json\n');
  process.exit(1);
}

process.stdout.write(`PUBLISHED ${engineId} (${files.length} objects + index.json) to r2://${bucket}\n`);

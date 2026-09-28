// Uploads a `pack-engine.ts` feed dir to R2 and merges it into index.json; the merge runs
// first, so a republished or malformed id uploads nothing. Needs wrangler auth:
// CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID with R2 write on the bucket.
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
const newIndex = args.includes('--new-index');

if (!feedDir || !engineId) {
  process.stderr.write(
    'usage: bun tools/engine/publish-engine-r2.ts <feedDir> <engineId> [--bucket <name>] [--new-index]\n',
  );
  process.exit(2);
}

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const wrangler = (...cmd: string[]): number =>
  Bun.spawnSync(['bunx', 'wrangler@4', 'r2', 'object', ...cmd, '--remote'], {
    stdout: 'inherit',
    stderr: 'inherit',
  }).exitCode;

const files = [`${engineId}.tar.zst`, `${engineId}.tar.zst.json`, `${engineId}.tar.zst.sig`];
for (const name of files) {
  if (!existsSync(join(feedDir, name))) {
    fail(`missing feed file: ${join(feedDir, name)}`);
  }
}

const manifest = parseRemoteManifest(
  readFileSync(join(feedDir, `${engineId}.tar.zst.json`), 'utf8'),
);
if (manifest.id !== engineId) {
  fail(`manifest id ${manifest.id} does not match ${engineId}`);
}

// From the bucket, not the CDN, so the merge sees every engine.
const work = mkdtempSync(join(tmpdir(), 'bunmaska-index-'));
const current = join(work, 'index-current.json');
const merged = join(work, 'index.json');
const hadIndex = wrangler('get', `${bucket}/index.json`, '--file', current) === 0;
if (!hadIndex && !newIndex) {
  // A failed read (auth, 5xx, network) must never replace the live index with one entry.
  fail(`could not read ${bucket}/index.json; pass --new-index only for a bucket with no index`);
}
writeFileSync(
  merged,
  mergeEngineIndex(hadIndex ? readFileSync(current, 'utf8') : undefined, manifest),
);

for (const name of files) {
  process.stdout.write(`uploading ${name} -> r2://${bucket}/${name}\n`);
  if (wrangler('put', `${bucket}/${name}`, '--file', join(feedDir, name)) !== 0) {
    fail(`wrangler put failed for ${name}`);
  }
}

process.stdout.write(`updating index.json (${hadIndex ? 'merged into existing' : 'new index'})\n`);
if (wrangler('put', `${bucket}/index.json`, '--file', merged) !== 0) {
  fail('wrangler put failed for index.json');
}

process.stdout.write(
  `PUBLISHED ${engineId} (${files.length} objects + index.json) to r2://${bucket}\n`,
);

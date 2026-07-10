/**
 * Publish a packed engine feed directory (the 3 files produced by
 * `pack-engine.ts`: `<id>.tar.zst` + `.json` + `.sig`) to a Cloudflare R2 bucket
 * via wrangler. The bucket is served at the feed base (`engines.bunmaska.org`),
 * so uploading these three objects is the entire "go live" step — the client
 * (`bunmaska engine install <id>`) then fetches + verifies them.
 *
 *   bun tools/engine/publish-engine-r2.ts <feedDir> <engineId> [--bucket <name>]
 *
 * Requires wrangler auth in the environment (CLOUDFLARE_API_TOKEN +
 * CLOUDFLARE_ACCOUNT_ID with R2 write on the bucket). Idempotent per object.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
  const proc = Bun.spawnSync(
    ['bunx', 'wrangler@4', 'r2', 'object', 'put', `${bucket}/${name}`, '--file', path, '--remote'],
    { stdout: 'inherit', stderr: 'inherit' },
  );
  if (proc.exitCode !== 0) {
    process.stderr.write(`wrangler put failed for ${name} (exit ${proc.exitCode})\n`);
    process.exit(1);
  }
}

process.stdout.write(`PUBLISHED ${engineId} (${files.length} objects) to r2://${bucket}\n`);

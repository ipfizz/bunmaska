import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { currentPlatform } from '../../../src/common/platform';

const MODULE = join(import.meta.dir, '../../../src/main/platform/macos/cocoa-website-data.ts');

describe.skipIf(currentPlatform() !== 'macos')('clearStorageData', () => {
  test('works in a fresh process where WebKit is not loaded yet', () => {
    // Only a fresh process shows the pre-WebKit state; this suite has already loaded it.
    const script = `import { clearStorageData } from ${JSON.stringify(MODULE)};
const result = clearStorageData();
const outcome = await Promise.race([
  result.then(() => 'settled', (error) => String(error)),
  Bun.sleep(100).then(() => 'pending'),
]);
console.log(outcome);
process.exit(0);`;
    const proc = Bun.spawnSync(['bun', '-e', script], { stdout: 'pipe', stderr: 'pipe' });
    expect(proc.stderr.toString()).toBe('');
    expect(proc.stdout.toString().trim()).toMatch(/^(pending|settled)$/);
  });
});

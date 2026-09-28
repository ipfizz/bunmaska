import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { currentPlatform } from '../../../src/common/platform';

const MACOS = join(import.meta.dir, '../../../src/main/platform/macos');

if (currentPlatform() === 'macos') {
  describe('clearStorageData', () => {
    test('works when called before WebKit is loaded', () => {
      // Only a fresh process shows the pre-WebKit state; this suite has already loaded it.
      const script = `import { clearStorageData } from ${JSON.stringify(`${MACOS}/cocoa-website-data.ts`)};
import { createMacOSApplication } from ${JSON.stringify(`${MACOS}/cocoa-backend.ts`)};
const result = clearStorageData();
const app = createMacOSApplication();
app.start();
const outcome = await Promise.race([
  result.then(() => 'settled', (error) => String(error)),
  Bun.sleep(10000).then(() => 'pending'),
]);
console.log(outcome);
app.quit();
process.exit(0);`;
      const proc = Bun.spawnSync(['bun', '-e', script], { stdout: 'pipe', stderr: 'pipe' });
      expect(proc.stderr.toString()).toBe('');
      expect(proc.stdout.toString().trim()).toBe('settled');
    });
  });
}

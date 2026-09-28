import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A temp directory holding `files` (relative path to contents); `using` deletes it. */
export const tempProject = (files: Record<string, string | Uint8Array>) => {
  const dir = mkdtempSync(join(tmpdir(), 'bunmaska-project-'));
  const write = (rel: string, contents: string | Uint8Array): void => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), contents);
  };
  for (const [rel, contents] of Object.entries(files)) {
    write(rel, contents);
  }
  return {
    dir,
    write,
    [Symbol.dispose]: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

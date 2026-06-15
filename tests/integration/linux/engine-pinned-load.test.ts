import { describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * End-to-end proof, on a real Linux box, that an app pinned to an engine-id
 * loads WebKitGTK from the shared STORE rather than the system soname.
 *
 * We don't need a hosted/relocatable engine build to prove the *mechanism*: we
 * relocate the system `libwebkitgtk` + `libgtk` into a store dir, pin to it via
 * `BUNMASKA_WEBKIT_ID`, and a subprocess (fresh dlopen cache) loads through the
 * real loader. `/proc/self/maps` then shows the store path = STORE_LOADED.
 * (Building a genuinely relocatable, cross-distro engine is the separate next
 * step; this validates resolve -> store -> dlopen end-to-end today.)
 */

const isLinux = process.platform === 'linux';

/** Resolve a soname to its absolute path via `ldconfig`; '' if not present. */
const resolveSoname = (soname: string): string => {
  const proc = Bun.spawnSync(['sh', '-c', `ldconfig -p | grep -F ${soname} | head -1`]);
  const match = new TextDecoder().decode(proc.stdout).match(/=>\s*(\S+)/);
  return match?.[1] ?? '';
};

describe.skipIf(!isLinux)('pinned engine load (Linux, real WebKitGTK)', () => {
  test('the loader dlopens WebKitGTK from the store dir, not the system', async () => {
    const sysWebkit = resolveSoname('libwebkitgtk-6.0.so.4');
    const sysGtk = resolveSoname('libgtk-4.so.1');
    if (sysWebkit === '' || sysGtk === '') {
      return; // no system WebKitGTK/GTK to relocate — nothing to prove here
    }

    const store = mkdtempSync(join(tmpdir(), 'bunmaska-pinned-'));
    try {
      const id = 'webkitgtk-6.0-0.0.0-probe-linux-x64';
      const lib = join(store, id, 'lib');
      mkdirSync(lib, { recursive: true });
      copyFileSync(sysWebkit, join(lib, 'libwebkitgtk-6.0.so.4'));
      copyFileSync(sysGtk, join(lib, 'libgtk-4.so.1'));
      writeFileSync(
        join(store, id, 'engine.json'),
        JSON.stringify({ id, soname: 'libwebkitgtk-6.0.so.4' }),
      );
      writeFileSync(join(store, id, 'INSTALLATION_COMPLETE'), `${new Date().toISOString()}\n`);

      const probe = join(import.meta.dir, 'fixtures', 'pinned-load-probe.ts');
      const proc = Bun.spawn(['bun', probe], {
        env: {
          ...process.env,
          BUNMASKA_ENGINES_PATH: store,
          BUNMASKA_WEBKIT_ID: id,
          // Capture the store on LD_LIBRARY_PATH at startup so the relocated
          // libgtk dependency also resolves from the store.
          LD_LIBRARY_PATH: `${lib}:${process.env['LD_LIBRARY_PATH'] ?? ''}`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const out = (await new Response(proc.stdout).text()).trim();
      const err = await new Response(proc.stderr).text();
      const code = await proc.exited;
      if (code !== 0) {
        throw new Error(`pinned-load probe exited ${code}: ${err}`);
      }
      expect(out).toBe('STORE_LOADED');
    } finally {
      rmSync(store, { recursive: true, force: true });
    }
  });
});

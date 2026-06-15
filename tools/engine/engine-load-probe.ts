/**
 * Build-engine probe: load WebKitGTK through the real loader from a relocated
 * engine in the store, then count how many shared objects resolved FROM the
 * engine dir. A high count proves the `$ORIGIN` rpaths make the whole dependency
 * closure self-contained (not just `libwebkitgtk` itself). Run with
 * `BUNMASKA_ENGINES_PATH` + `BUNMASKA_WEBKIT_ID` set, and deliberately WITHOUT
 * `LD_LIBRARY_PATH`, so the deps must resolve via the engine's own rpaths.
 */

import { readFileSync } from 'node:fs';
import { loadWebKitGtkFFI } from '../../src/main/platform/linux/webkitgtk-ffi';

loadWebKitGtkFFI(); // dlopen the relocated engine; its NEEDED libs resolve via $ORIGIN

const maps = readFileSync('/proc/self/maps', 'utf8');
const store = process.env['BUNMASKA_ENGINES_PATH'] ?? '/nonexistent-store';
const fromEngine = new Set(
  maps
    .split('\n')
    .map((line) => line.trim().split(/\s+/).pop() ?? '')
    .filter((path) => path.startsWith(store) && path.includes('.so')),
);
process.stdout.write(`STORE_LIBS=${fromEngine.size}\n`);

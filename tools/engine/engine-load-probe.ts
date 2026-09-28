// Counts the shared objects a pinned store engine loads from its own dir. Run it WITHOUT
// LD_LIBRARY_PATH, so the closure must resolve through the engine's `$ORIGIN` rpaths.

import { readFileSync } from 'node:fs';
import { loadWebKitGtkFFI } from '../../src/main/platform/linux/webkitgtk-ffi';

loadWebKitGtkFFI();

const maps = readFileSync('/proc/self/maps', 'utf8');
const store = process.env['BUNMASKA_ENGINES_PATH'] ?? '/nonexistent-store';
const fromEngine = new Set(
  maps
    .split('\n')
    .map((line) => line.trim().split(/\s+/).pop() ?? '')
    .filter((path) => path.startsWith(store) && path.includes('.so')),
);
process.stdout.write(`STORE_LIBS=${fromEngine.size}\n`);

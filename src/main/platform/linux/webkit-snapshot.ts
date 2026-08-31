import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pointer } from 'bun:ffi';
import { cstr } from '../cstr';
import { loadCairoFFI } from './cairo-ffi';
import { runAsyncReady, withDeadline } from './gasync';
import {
  WEBKIT_SNAPSHOT_OPTIONS_NONE,
  WEBKIT_SNAPSHOT_REGION_VISIBLE,
  loadWebKitGtkFFI,
} from './webkitgtk-ffi';

/**
 * `webContents.capturePage` on Linux: snapshot the visible viewport to a cairo
 * surface, PNG-encode it through a temp file (cairo has no to-memory PNG API
 * without a write-func callback - a temp file avoids another JSCallback
 * lifetime hazard), and resolve the bytes.
 */

const RENDER_TIMEOUT_MS = 30_000;

export const capturePage = (view: Pointer): Promise<Uint8Array> => {
  const wk = loadWebKitGtkFFI().symbols;
  return withDeadline(
    runAsyncReady(
      (cb) =>
        wk.webkit_web_view_get_snapshot(
          view,
          WEBKIT_SNAPSHOT_REGION_VISIBLE,
          WEBKIT_SNAPSHOT_OPTIONS_NONE,
          null,
          cb,
          null,
        ),
      (result) => {
        const surface = wk.webkit_web_view_get_snapshot_finish(view, result, null);
        if (surface === null) {
          throw new Error('capturePage failed (webkit_web_view_get_snapshot returned no surface)');
        }
        const cairo = loadCairoFFI().symbols;
        const dir = mkdtempSync(join(tmpdir(), 'bunmaska-capture-'));
        const file = join(dir, 'capture.png');
        try {
          const status = cairo.cairo_surface_write_to_png(surface, cstr(file));
          if (status !== 0) {
            throw new Error(`capturePage failed (cairo status ${status})`);
          }
          return new Uint8Array(readFileSync(file));
        } finally {
          cairo.cairo_surface_destroy(surface);
          rmSync(dir, { recursive: true, force: true });
        }
      },
    ),
    RENDER_TIMEOUT_MS,
    'capturePage',
  );
};

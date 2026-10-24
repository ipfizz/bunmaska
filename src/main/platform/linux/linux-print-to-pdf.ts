import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSCallback, type Pointer } from 'bun:ffi';
import { cstr } from '../cstr';
import { loadGObjectFFI } from './gobject-ffi';
import { loadGtkFFI } from './gtk-ffi';
import { connectSignal, deferCallbackClose } from './gtk-signals';
import { loadWebKitGtkFFI } from './webkitgtk-ffi';

const PRINT_TIMEOUT_MS = 30_000;
const FINISHED_CB_DEF = { args: ['ptr', 'ptr'], returns: 'void' } as const;

/** Print the view to a temporary PDF and return its bytes. */
export const linuxPrintToPDF = (view: Pointer): Promise<Uint8Array> => {
  const dir = mkdtempSync(join(tmpdir(), 'bunmaska-pdf-'));
  const path = join(dir, 'page.pdf');
  const uri = pathToFileURL(path).href;
  const wk = loadWebKitGtkFFI().symbols;
  const gtk = loadGtkFFI().symbols;
  const operation = wk.webkit_print_operation_new(view);
  if (operation === null) {
    rmSync(dir, { recursive: true, force: true });
    return Promise.reject(new Error('webkit_print_operation_new returned null'));
  }
  const settings = gtk.gtk_print_settings_new();
  if (settings === null) {
    loadGObjectFFI().symbols.g_object_unref(operation);
    rmSync(dir, { recursive: true, force: true });
    return Promise.reject(new Error('gtk_print_settings_new returned null'));
  }
  gtk.gtk_print_settings_set(settings, cstr('printer'), cstr('Print to File'));
  gtk.gtk_print_settings_set(settings, cstr('output-file-format'), cstr('pdf'));
  gtk.gtk_print_settings_set(settings, cstr('output-uri'), cstr(uri));
  wk.webkit_print_operation_set_print_settings(operation, settings);

  return new Promise<Uint8Array>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`printToPDF timed out after ${PRINT_TIMEOUT_MS}ms`));
    }, PRINT_TIMEOUT_MS);
    const callback = new JSCallback(() => {
      clearTimeout(timer);
      loadGObjectFFI().symbols.g_signal_handler_disconnect(operation, connection.handlerId);
      deferCallbackClose([
        callback,
        {
          close: () => {
            loadGObjectFFI().symbols.g_object_unref(operation);
            loadGObjectFFI().symbols.g_object_unref(settings);
          },
        },
      ]);
      try {
        resolve(new Uint8Array(readFileSync(path)));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, FINISHED_CB_DEF);
    const connection = connectSignal(operation, 'finished', callback);
    wk.webkit_print_operation_print(operation);
  });
};

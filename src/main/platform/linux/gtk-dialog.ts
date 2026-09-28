import { CString, type Pointer, ptr } from 'bun:ffi';
import type { DialogBackend } from '../../api/dialog';
import { cstr } from '../cstr';
import { runAsyncReady } from './gasync';
import { loadGioFFI } from './gio-ffi';
import { loadGlibFFI } from './glib-ffi';
import { loadGObjectFFI } from './gobject-ffi';
import { loadGtkDialogFFI, loadGtkDialogGObjectFFI } from './gtk-dialog-ffi';

// GtkAlertDialog and GtkFileDialog (GTK 4.10+). Callback lifetime rules live in gasync.ts.

/**
 * The NULL-terminated `const char* const*` for `gtk_alert_dialog_set_buttons`. Keep `array`
 * AND `buffers` referenced until that call returns: Bun may GC a buffer whose `ptr()` was taken.
 */
export type ButtonsArray = {
  readonly array: BigUint64Array;
  readonly buffers: ReadonlyArray<Uint8Array>;
};

export const buildButtonsArray = (labels: ReadonlyArray<string>): ButtonsArray => {
  const buffers = labels.map((label) => cstr(label));
  const array = new BigUint64Array(buffers.length + 1);
  for (let i = 0; i < buffers.length; i += 1) {
    array[i] = BigInt(ptr(buffers[i] as Uint8Array));
  }
  array[buffers.length] = 0n;
  return { array, buffers };
};

/** A negative `choose_finish` index (Escape or an error) is the `cancelId` response. */
export const mapChooseResult = (index: number, cancelId: number): number =>
  index >= 0 ? index : cancelId;

/** Electron's default cancelId: the first "cancel" or "no" button (case-insensitive), else 0. */
export const cancelIdForButtons = (buttons: ReadonlyArray<string>): number => {
  const idx = buttons.findIndex((label) => ['cancel', 'no'].includes(label.toLowerCase()));
  return idx >= 0 ? idx : 0;
};

export type SettleChooseArgs = {
  readonly result: Pointer;
  readonly cancelId: number;
  /** Calls `gtk_alert_dialog_choose_finish`. */
  readonly finish: (result: Pointer) => number;
};

/** The message-box response; a throwing `finish` counts as a dismissal. */
export const settleChoose = (args: SettleChooseArgs): number => {
  let index: number;
  try {
    index = args.finish(args.result);
  } catch {
    index = -1;
  }
  return mapChooseResult(index, args.cancelId);
};

export type SettleFilePathArgs = {
  readonly result: Pointer;
  /** Calls `gtk_file_dialog_*_finish`; null on cancel. */
  readonly finish: (result: Pointer) => Pointer | null;
  /** Reads the path out of, and releases, a non-null `GFile*`. */
  readonly readPath: (file: Pointer) => string;
};

/** The chosen path; `''` on cancel or a throwing `finish`. */
export const settleFilePath = (args: SettleFilePathArgs): string => {
  let file: Pointer | null;
  try {
    file = args.finish(args.result);
  } catch {
    return '';
  }
  return file === null ? '' : args.readPath(file);
};

/** Read the local path out of a transfer-full `GFile*`, releasing the file and the `char*`. */
const readGFilePath = (file: Pointer): string => {
  const glib = loadGlibFFI();
  const pathPtr = loadGioFFI().symbols.g_file_get_path(file);
  loadGObjectFFI().symbols.g_object_unref(file);
  if (pathPtr === null) {
    return '';
  }
  const path = new CString(pathPtr).toString();
  glib.symbols.g_free(pathPtr);
  return path;
};

const showMessageBox = (spec: {
  readonly message: string;
  readonly detail: string;
  readonly buttons: ReadonlyArray<string>;
  // GtkAlertDialog has no severity concept, so `type` is accepted but ignored.
  readonly type?: string;
}): Promise<number> => {
  const gtk = loadGtkDialogFFI();
  const gobject = loadGtkDialogGObjectFFI();
  const dialog = gobject.symbols.g_object_new(gtk.symbols.gtk_alert_dialog_get_type(), null);
  if (dialog === null) {
    throw new Error('g_object_new(GtkAlertDialog) returned null');
  }
  gtk.symbols.gtk_alert_dialog_set_message(dialog, cstr(spec.message));
  gtk.symbols.gtk_alert_dialog_set_detail(dialog, cstr(spec.detail));
  gtk.symbols.gtk_alert_dialog_set_modal(dialog, 1);
  const labels = spec.buttons.length > 0 ? spec.buttons : ['OK'];
  // set_buttons copies the labels, so the buffers need only outlive this synchronous call.
  const buttons = buildButtonsArray(labels);
  gtk.symbols.gtk_alert_dialog_set_buttons(dialog, ptr(buttons.array.buffer));
  const cancelId = cancelIdForButtons(labels);
  return runAsyncReady<number>(
    (cbPtr) => gtk.symbols.gtk_alert_dialog_choose(dialog, null, null, cbPtr, null),
    (result) =>
      settleChoose({
        result,
        cancelId,
        finish: (r) => gtk.symbols.gtk_alert_dialog_choose_finish(dialog, r, null),
      }),
  ).finally(() => loadGObjectFFI().symbols.g_object_unref(dialog));
};

/** A `*.ext` glob matching any letter case; GTK's add_pattern is case-sensitive off Windows. */
export const extensionPattern = (ext: string): string => {
  const chars = [...ext].map((c) => {
    const lower = c.toLowerCase();
    const upper = c.toUpperCase();
    return lower === upper ? c : `[${lower}${upper}]`;
  });
  return `*.${chars.join('')}`;
};

/** No filter when `extensions` is empty. */
const applyExtensionFilter = (
  gtk: ReturnType<typeof loadGtkDialogFFI>,
  fileDialog: Pointer,
  extensions: ReadonlyArray<string>,
): void => {
  if (extensions.length === 0) {
    return;
  }
  const filter = gtk.symbols.gtk_file_filter_new();
  if (filter === null) {
    return;
  }
  for (const ext of extensions) {
    gtk.symbols.gtk_file_filter_add_pattern(filter, cstr(extensionPattern(ext)));
  }
  gtk.symbols.gtk_file_dialog_set_default_filter(fileDialog, filter);
  loadGObjectFFI().symbols.g_object_unref(filter);
};

// ponytail: single-file open only; openDirectory, multiSelections and defaultPath need
// gtk_file_dialog_select_folder, _open_multiple and _set_initial_folder in gtk-dialog-ffi.
const showOpenDialog = (spec: {
  readonly canChooseFiles: boolean;
  readonly canChooseDirectories: boolean;
  readonly allowsMultipleSelection: boolean;
  readonly extensions: ReadonlyArray<string>;
}): Promise<string[]> => {
  const gtk = loadGtkDialogFFI();
  const fileDialog = gtk.symbols.gtk_file_dialog_new();
  if (fileDialog === null) {
    throw new Error('gtk_file_dialog_new() returned null');
  }
  gtk.symbols.gtk_file_dialog_set_title(fileDialog, cstr('Open'));
  gtk.symbols.gtk_file_dialog_set_modal(fileDialog, 1);
  applyExtensionFilter(gtk, fileDialog, spec.extensions);
  return runAsyncReady<string[]>(
    (cbPtr) => gtk.symbols.gtk_file_dialog_open(fileDialog, null, null, cbPtr, null),
    (result) => {
      const path = settleFilePath({
        result,
        finish: (r) => gtk.symbols.gtk_file_dialog_open_finish(fileDialog, r, null),
        readPath: readGFilePath,
      });
      return path === '' ? [] : [path];
    },
  ).finally(() => loadGObjectFFI().symbols.g_object_unref(fileDialog));
};

const showSaveDialog = (spec: {
  readonly defaultName: string;
  readonly extensions: ReadonlyArray<string>;
}): Promise<string> => {
  const gtk = loadGtkDialogFFI();
  const fileDialog = gtk.symbols.gtk_file_dialog_new();
  if (fileDialog === null) {
    throw new Error('gtk_file_dialog_new() returned null');
  }
  gtk.symbols.gtk_file_dialog_set_title(fileDialog, cstr('Save'));
  gtk.symbols.gtk_file_dialog_set_modal(fileDialog, 1);
  if (spec.defaultName.length > 0) {
    gtk.symbols.gtk_file_dialog_set_initial_name(fileDialog, cstr(spec.defaultName));
  }
  applyExtensionFilter(gtk, fileDialog, spec.extensions);
  return runAsyncReady<string>(
    (cbPtr) => gtk.symbols.gtk_file_dialog_save(fileDialog, null, null, cbPtr, null),
    (result) =>
      settleFilePath({
        result,
        finish: (r) => gtk.symbols.gtk_file_dialog_save_finish(fileDialog, r, null),
        readPath: readGFilePath,
      }),
  ).finally(() => loadGObjectFFI().symbols.g_object_unref(fileDialog));
};

export const linuxDialogBackend: DialogBackend = {
  showMessageBox,
  showOpenDialog,
  showSaveDialog,
};

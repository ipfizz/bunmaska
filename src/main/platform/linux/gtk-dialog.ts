import { CString, JSCallback, type Pointer, ptr } from 'bun:ffi';
import type { DialogBackend } from '../../api/dialog';
import { cstr } from '../cstr';
import { loadGioFFI } from './gio-ffi';
import { loadGlibFFI } from './glib-ffi';
import { loadGtkDialogFFI, loadGtkDialogGObjectFFI } from './gtk-dialog-ffi';

/**
 * Native dialogs for the Linux backend — the GTK 4 equivalent of the macOS
 * `cocoa-dialog` module. `GtkAlertDialog` powers `showMessageBox`;
 * `GtkFileDialog` powers `showOpenDialog`/`showSaveDialog` (both added 4.10,
 * always present on the CI runner's GTK 4.12+).
 *
 * Unlike Cocoa's blocking `runModal`, GTK's dialogs are asynchronous: each
 * `gtk_*_choose/open/save` call kicks off the modal dialog and invokes a
 * `GAsyncReadyCallback` when the user settles it; the matching `*_finish` reads
 * the value. The backend methods therefore return Promises (the `dialog` API's
 * `await` flattens them).
 *
 * JSCallback lifecycle safety (a past SIGSEGV regression): the
 * `GAsyncReadyCallback` thunk MUST stay reachable until GTK fires it, and it
 * MUST NOT be `close()`d synchronously inside its own invocation (that frees the
 * native trampoline the GTK caller is about to return into). Each in-flight
 * callback is therefore retained in the module-level {@link inFlight} set and
 * its `close()` is deferred to a later tick via `setTimeout(..., 0)`.
 */

/** ABI shape for `GAsyncReadyCallback`: `(source, result, user_data) -> void`. */
export const ALERT_CHOOSE_CB_DEF = { args: ['ptr', 'ptr', 'ptr'], returns: 'void' } as const;

/** Every JSCallback awaiting a GTK async settle. Retained so Bun can't GC it. */
const inFlight = new Set<JSCallback>();

/**
 * The NULL-terminated `const char* const*` button-label array for
 * `gtk_alert_dialog_set_buttons`, plus the backing cstr buffers.
 *
 * GTK reads the array (and each string) only during the synchronous
 * `set_buttons` call, but Bun may GC a `Uint8Array` whose pointer was taken via
 * `ptr()` the moment it falls out of scope — so the caller MUST keep BOTH the
 * returned `array` and every entry of `buffers` referenced until that call
 * returns.
 */
export type ButtonsArray = {
  /** `BigUint64Array` of cstr pointers, NULL-terminated with a trailing `0n`. */
  readonly array: BigUint64Array;
  /** One retained NUL-terminated UTF-8 buffer per label. */
  readonly buffers: ReadonlyArray<Uint8Array>;
};

/** Build the NULL-terminated `const char* const*` array of button labels. */
export const buildButtonsArray = (labels: ReadonlyArray<string>): ButtonsArray => {
  const buffers = labels.map((label) => cstr(label));
  const array = new BigUint64Array(buffers.length + 1);
  for (let i = 0; i < buffers.length; i += 1) {
    array[i] = BigInt(ptr(buffers[i] as Uint8Array));
  }
  array[buffers.length] = 0n;
  return { array, buffers };
};

/**
 * Map the raw `gtk_alert_dialog_choose_finish` button index to the response.
 * A valid (`>= 0`) index is returned as-is; the dismissal sentinel (`-1`) and
 * any error index fall back to `cancelId` (Electron semantics).
 */
export const mapChooseResult = (index: number, _defaultId: number, cancelId: number): number =>
  index >= 0 ? index : cancelId;

/**
 * Compute the cancel index for a message box: the index of a button labelled
 * "Cancel" (case-insensitive), else `0`. The {@link MessageBoxSpec} carries no
 * explicit cancelId, so this mirrors Electron's default of treating a Cancel
 * button (or the first button) as the dismissal response.
 */
const cancelIdForButtons = (buttons: ReadonlyArray<string>): number => {
  const idx = buttons.findIndex((label) => label.toLowerCase() === 'cancel');
  return idx >= 0 ? idx : 0;
};

/** Settle inputs for `gtk_alert_dialog_choose`, with the finish step injectable. */
export type SettleChooseArgs = {
  readonly result: Pointer;
  readonly defaultId: number;
  readonly cancelId: number;
  /** Calls `gtk_alert_dialog_choose_finish`; may throw on the GError path. */
  readonly finish: (result: Pointer) => number;
};

/**
 * Produce the message-box response from a `GAsyncResult`. Pure but for the
 * injected `finish`, so it is unit-testable without a real dialog. A thrown
 * `finish` (the `GError` dismissal path) maps to `cancelId`.
 */
export const settleChoose = (args: SettleChooseArgs): number => {
  let index: number;
  try {
    index = args.finish(args.result);
  } catch {
    index = -1;
  }
  return mapChooseResult(index, args.defaultId, args.cancelId);
};

/** Settle inputs for `gtk_file_dialog_open/save`, with finish + reader injectable. */
export type SettleFilePathArgs = {
  readonly result: Pointer;
  /** Calls `gtk_file_dialog_*_finish`; returns a `GFile*` or null; may throw. */
  readonly finish: (result: Pointer) => Pointer | null;
  /** Reads (and frees) the path out of a non-null `GFile*`. */
  readonly readPath: (file: Pointer) => string;
};

/**
 * Produce a file path from a `GAsyncResult`. A null `GFile*` (cancel) or a
 * thrown `finish` (dismissal) yields `''`. Pure but for the injected functions.
 */
export const settleFilePath = (args: SettleFilePathArgs): string => {
  let file: Pointer | null;
  try {
    file = args.finish(args.result);
  } catch {
    return '';
  }
  return file === null ? '' : args.readPath(file);
};

/** Read the local path out of a `GFile*`, freeing the transfer-full `char*`. */
const readGFilePath = (file: Pointer): string => {
  const gio = loadGioFFI();
  const glib = loadGlibFFI();
  const pathPtr = gio.symbols.g_file_get_path(file);
  if (pathPtr === null) {
    return '';
  }
  const path = new CString(pathPtr).toString();
  glib.symbols.g_free(pathPtr);
  return path;
};

/**
 * Run a one-shot GTK async dialog: register a retained `GAsyncReadyCallback`,
 * invoke `start` to kick off the dialog, and resolve the returned Promise from
 * the callback. The callback is removed from {@link inFlight} and closed on a
 * later tick (NEVER synchronously inside its own invocation).
 */
const runAsyncDialog = <T>(
  start: (callbackPtr: Pointer) => void,
  settle: (result: Pointer) => T,
): Promise<T> =>
  new Promise<T>((resolve) => {
    const callback = new JSCallback((_source: Pointer, result: Pointer, _userData: Pointer) => {
      const value = settle(result);
      resolve(value);
      setTimeout(() => {
        inFlight.delete(callback);
        callback.close();
      }, 0);
    }, ALERT_CHOOSE_CB_DEF);
    inFlight.add(callback);
    const cbPtr = callback.ptr;
    if (cbPtr === null) {
      inFlight.delete(callback);
      throw new Error('Failed to allocate a GAsyncReadyCallback thunk for the GTK dialog');
    }
    start(cbPtr);
  });

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
  // `set_buttons` copies the labels internally, so the buffers need only outlive
  // this synchronous call (not the async choose() round-trip).
  const buttons = buildButtonsArray(labels);
  gtk.symbols.gtk_alert_dialog_set_buttons(dialog, ptr(buttons.array.buffer));
  const cancelId = cancelIdForButtons(labels);
  return runAsyncDialog<number>(
    (cbPtr) => gtk.symbols.gtk_alert_dialog_choose(dialog, null, null, cbPtr, null),
    (result) =>
      settleChoose({
        result,
        defaultId: 0,
        cancelId,
        finish: (r) => gtk.symbols.gtk_alert_dialog_choose_finish(dialog, r, null),
      }),
  );
};

/** Set a default `GtkFileFilter` of `*.ext` patterns, when any extension is given. */
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
    gtk.symbols.gtk_file_filter_add_pattern(filter, cstr(`*.${ext}`));
  }
  gtk.symbols.gtk_file_dialog_set_default_filter(fileDialog, filter);
};

// The open spec's file/directory/multi flags are accepted for API parity but
// not yet applied: v1 always presents a single-file open. Directory selection
// (gtk_file_dialog_select_folder) and multi-select (gtk_file_dialog_open_multiple)
// are out of scope.
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
  return runAsyncDialog<string[]>(
    (cbPtr) => gtk.symbols.gtk_file_dialog_open(fileDialog, null, null, cbPtr, null),
    (result) => {
      const path = settleFilePath({
        result,
        finish: (r) => gtk.symbols.gtk_file_dialog_open_finish(fileDialog, r, null),
        readPath: readGFilePath,
      });
      return path === '' ? [] : [path];
    },
  );
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
  return runAsyncDialog<string>(
    (cbPtr) => gtk.symbols.gtk_file_dialog_save(fileDialog, null, null, cbPtr, null),
    (result) =>
      settleFilePath({
        result,
        finish: (r) => gtk.symbols.gtk_file_dialog_save_finish(fileDialog, r, null),
        readPath: readGFilePath,
      }),
  );
};

/** The Linux native dialog backend (single-path open; multi-select is v2). */
export const linuxDialogBackend: DialogBackend = {
  showMessageBox,
  showOpenDialog,
  showSaveDialog,
};

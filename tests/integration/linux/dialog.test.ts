import { ptr } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { cstr } from '../../../src/main/platform/cstr';
import { buildButtonsArray } from '../../../src/main/platform/linux/gtk-dialog';
import { loadGtkDialogFFI } from '../../../src/main/platform/linux/gtk-dialog-ffi';
import { loadGioFFI } from '../../../src/main/platform/linux/gio-ffi';
import { loadGObjectFFI } from '../../../src/main/platform/linux/gobject-ffi';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';

/**
 * Linux-only. Mirrors how `cocoa-dialog.test.ts` tests ONLY the non-blocking
 * BUILD steps: a `GtkAlertDialog`/`GtkFileDialog` can be constructed and its
 * setters called without crashing. It deliberately does NOT call
 * `gtk_alert_dialog_choose` / `gtk_file_dialog_open/save` — those open a modal
 * dialog and await a user response, which would HANG forever under a headless
 * xvfb CI display with no user to click. So CI verifies symbol resolution +
 * construction + setter dispatch; it CANNOT verify a real click/pick round-trip.
 */
const isLinux = currentPlatform() === 'linux';
const hasDisplay = isLinux && loadGtkFFI().symbols.gtk_init_check() !== 0;

describe.skipIf(!isLinux)('GTK dialog FFI + construction (Linux)', () => {
  test('loadGtkDialogFFI resolves every dialog symbol without throwing', () => {
    const lib = loadGtkDialogFFI();
    for (const name of [
      'gtk_alert_dialog_get_type',
      'gtk_alert_dialog_set_message',
      'gtk_alert_dialog_set_detail',
      'gtk_alert_dialog_set_modal',
      'gtk_alert_dialog_set_buttons',
      'gtk_alert_dialog_choose',
      'gtk_alert_dialog_choose_finish',
      'gtk_file_dialog_new',
      'gtk_file_dialog_set_title',
      'gtk_file_dialog_set_modal',
      'gtk_file_dialog_set_initial_name',
      'gtk_file_dialog_open',
      'gtk_file_dialog_open_finish',
      'gtk_file_dialog_open_multiple',
      'gtk_file_dialog_open_multiple_finish',
      'gtk_file_dialog_select_folder',
      'gtk_file_dialog_select_folder_finish',
      'gtk_file_dialog_select_multiple_folders',
      'gtk_file_dialog_select_multiple_folders_finish',
      'gtk_file_dialog_set_initial_folder',
      'gtk_file_dialog_set_initial_file',
      'gtk_file_dialog_save',
      'gtk_file_dialog_save_finish',
    ] as const) {
      expect(typeof lib.symbols[name]).toBe('function');
    }
  });

  test.skipIf(!hasDisplay)(
    'constructs a GtkAlertDialog and calls every setter without crashing',
    () => {
      const dialogLib = loadGtkDialogFFI();
      const dialog = loadGObjectFFI().symbols.g_object_new(
        dialogLib.symbols.gtk_alert_dialog_get_type(),
        null,
        null,
        null,
      );
      expect(dialog).not.toBeNull();
      dialogLib.symbols.gtk_alert_dialog_set_message(dialog, cstr('Hello'));
      dialogLib.symbols.gtk_alert_dialog_set_detail(dialog, cstr('Details here'));
      dialogLib.symbols.gtk_alert_dialog_set_modal(dialog, 1);
      const buttons = buildButtonsArray(['OK', 'Cancel']);
      dialogLib.symbols.gtk_alert_dialog_set_buttons(dialog, ptr(buttons.array.buffer));
    },
  );

  test.skipIf(!hasDisplay)(
    'constructs a GtkFileDialog and calls set_title/set_modal/set_initial_name',
    () => {
      const dialogLib = loadGtkDialogFFI();
      const fileDialog = dialogLib.symbols.gtk_file_dialog_new();
      expect(fileDialog).not.toBeNull();
      dialogLib.symbols.gtk_file_dialog_set_title(fileDialog, cstr('Open'));
      dialogLib.symbols.gtk_file_dialog_set_modal(fileDialog, 1);
      dialogLib.symbols.gtk_file_dialog_set_initial_name(fileDialog, cstr('untitled.txt'));
    },
  );

  test.skipIf(!hasDisplay)('points a GtkFileDialog at an initial folder and file', () => {
    const dialogLib = loadGtkDialogFFI();
    const gio = loadGioFFI().symbols;
    const fileDialog = dialogLib.symbols.gtk_file_dialog_new();
    const folder = gio.g_file_new_for_path(cstr('/tmp'));
    const file = gio.g_file_new_for_path(cstr('/tmp/bunmaska-missing.txt'));
    expect(folder).not.toBeNull();
    dialogLib.symbols.gtk_file_dialog_set_initial_folder(fileDialog, folder);
    dialogLib.symbols.gtk_file_dialog_set_initial_file(fileDialog, file);
    const gobject = loadGObjectFFI().symbols;
    for (const object of [folder, file, fileDialog]) {
      gobject.g_object_unref(object);
    }
  });
});

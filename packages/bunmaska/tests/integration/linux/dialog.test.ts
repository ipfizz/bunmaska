import { ptr } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { cstr } from '../../../src/main/platform/cstr';
import { buildButtonsArray } from '../../../src/main/platform/linux/gtk-dialog';
import {
  loadGtkDialogFFI,
  loadGtkDialogGObjectFFI,
} from '../../../src/main/platform/linux/gtk-dialog-ffi';
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
      'gtk_file_dialog_save',
      'gtk_file_dialog_save_finish',
    ] as const) {
      expect(typeof lib.symbols[name]).toBe('function');
    }
  });

  test('the 2-arity g_object_new resolves', () => {
    const gobject = loadGtkDialogGObjectFFI();
    expect(typeof gobject.symbols.g_object_new).toBe('function');
  });

  test('constructs a GtkAlertDialog and calls every setter without crashing', () => {
    const gtk = loadGtkFFI();
    if (gtk.symbols.gtk_init_check() === 0) {
      return; // No display; symbol-resolution assertions above already proved dispatch.
    }
    const dialogLib = loadGtkDialogFFI();
    const gobject = loadGtkDialogGObjectFFI();
    const dialog = gobject.symbols.g_object_new(
      dialogLib.symbols.gtk_alert_dialog_get_type(),
      null,
    );
    expect(dialog).not.toBeNull();
    dialogLib.symbols.gtk_alert_dialog_set_message(dialog, cstr('Hello'));
    dialogLib.symbols.gtk_alert_dialog_set_detail(dialog, cstr('Details here'));
    dialogLib.symbols.gtk_alert_dialog_set_modal(dialog, 1);
    const buttons = buildButtonsArray(['OK', 'Cancel']);
    dialogLib.symbols.gtk_alert_dialog_set_buttons(dialog, ptr(buttons.array.buffer));
  });

  test('constructs a GtkFileDialog and calls set_title/set_modal/set_initial_name', () => {
    const gtk = loadGtkFFI();
    if (gtk.symbols.gtk_init_check() === 0) {
      return;
    }
    const dialogLib = loadGtkDialogFFI();
    const fileDialog = dialogLib.symbols.gtk_file_dialog_new();
    expect(fileDialog).not.toBeNull();
    dialogLib.symbols.gtk_file_dialog_set_title(fileDialog, cstr('Open'));
    dialogLib.symbols.gtk_file_dialog_set_modal(fileDialog, 1);
    dialogLib.symbols.gtk_file_dialog_set_initial_name(fileDialog, cstr('untitled.txt'));
  });
});

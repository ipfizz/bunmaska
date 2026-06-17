import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import * as cocoaDialog from '../platform/macos/cocoa-dialog';
import { linuxDialogBackend } from '../platform/linux/gtk-dialog';

/**
 * Native system dialogs — the drop-in equivalent of Electron's `dialog`.
 *
 * Methods return Promises to match Electron's async API. The macOS backend runs
 * the panels modally (synchronously) under the hood; the Linux backend is truly
 * async (GTK's `GtkAlertDialog`/`GtkFileDialog` resolve via a
 * `GAsyncReadyCallback`). The `DialogBackend` methods therefore allow either a
 * value or a Promise, and the API layer wraps each in `Promise.resolve(...)`
 * which flattens a returned Promise transparently. The native backend is
 * injectable so the option-mapping and result-shaping logic is unit-testable
 * without showing a real dialog.
 */

export type MessageBoxOptions = {
  readonly message: string;
  readonly detail?: string;
  /** Button labels; defaults to `['OK']`. The first is the default button. */
  readonly buttons?: ReadonlyArray<string>;
  /**
   * Severity: `info` | `error` | `question` | `warning` | `none`. Styles the
   * `NSAlert` icon on macOS; GtkAlertDialog has no severity, so it is a no-op on
   * Linux.
   */
  readonly type?: cocoaDialog.MessageBoxType;
};

export type MessageBoxReturnValue = {
  /** Index of the clicked button. */
  readonly response: number;
};

/** An Electron file-type filter: a label and its allowed extensions (no dots; `*` = any). */
export type FileFilter = {
  readonly name: string;
  readonly extensions: ReadonlyArray<string>;
};

export type OpenDialogOptions = {
  /** Defaults to `['openFile']`. */
  readonly properties?: ReadonlyArray<'openFile' | 'openDirectory' | 'multiSelections'>;
  /** File-type filters; the selectable extensions are their union. */
  readonly filters?: ReadonlyArray<FileFilter>;
};

export type OpenDialogReturnValue = {
  readonly canceled: boolean;
  readonly filePaths: string[];
};

export type SaveDialogOptions = {
  /** Suggested file name shown in the panel. */
  readonly defaultPath?: string;
  /** File-type filters; the allowed extensions are their union. */
  readonly filters?: ReadonlyArray<FileFilter>;
};

/** The deduped union of all filter extensions, dropping the `*` wildcard. */
export const flattenFilterExtensions = (filters?: ReadonlyArray<FileFilter>): string[] => {
  if (filters === undefined) {
    return [];
  }
  const seen = new Set<string>();
  for (const filter of filters) {
    for (const ext of filter.extensions) {
      if (ext !== '*') {
        seen.add(ext);
      }
    }
  }
  return [...seen];
};

export type SaveDialogReturnValue = {
  readonly canceled: boolean;
  readonly filePath: string;
};

/**
 * The native backend the public dialog API delegates to.
 *
 * Each method may return its value synchronously (macOS, which runs panels
 * modally) or a Promise (Linux, whose GTK dialogs settle asynchronously). The
 * API layer's `Promise.resolve(...)` flattens both uniformly.
 */
export type DialogBackend = {
  showMessageBox(spec: cocoaDialog.MessageBoxSpec): number | Promise<number>;
  showOpenDialog(spec: cocoaDialog.OpenDialogSpec): string[] | Promise<string[]>;
  showSaveDialog(spec: cocoaDialog.SaveDialogSpec): string | Promise<string>;
};

const macosBackend: DialogBackend = {
  showMessageBox: (spec) => cocoaDialog.showMessageBox(spec),
  showOpenDialog: (spec) => cocoaDialog.showOpenDialog(spec),
  showSaveDialog: (spec) => cocoaDialog.showSaveDialog(spec),
};

let backend: DialogBackend | undefined;

const getBackend = (): DialogBackend => {
  if (backend !== undefined) {
    return backend;
  }
  if (currentPlatform() === 'macos') {
    return macosBackend;
  }
  if (currentPlatform() === 'linux') {
    return linuxDialogBackend;
  }
  throw new UnsupportedPlatformError(`dialog is not supported on ${currentPlatform()} yet`);
};

/** Override the native dialog backend. Test-only. */
export const setDialogBackendForTesting = (fake: DialogBackend | undefined): void => {
  backend = fake;
};

export type Dialog = {
  showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue>;
  showOpenDialog(options?: OpenDialogOptions): Promise<OpenDialogReturnValue>;
  showSaveDialog(options?: SaveDialogOptions): Promise<SaveDialogReturnValue>;
  showErrorBox(title: string, content: string): void;
};

export const dialog: Dialog = {
  // `await` flattens a sync value (macOS) or a Promise (Linux) uniformly before
  // the result object is constructed, so a Promise is never double-wrapped.
  async showMessageBox(options) {
    const response = await getBackend().showMessageBox({
      message: options.message,
      detail: options.detail ?? '',
      buttons: options.buttons ?? ['OK'],
      ...(options.type !== undefined ? { type: options.type } : {}),
    });
    return { response };
  },

  async showOpenDialog(options = {}) {
    const properties = options.properties ?? ['openFile'];
    const filePaths = await getBackend().showOpenDialog({
      canChooseFiles: properties.includes('openFile'),
      canChooseDirectories: properties.includes('openDirectory'),
      allowsMultipleSelection: properties.includes('multiSelections'),
      extensions: flattenFilterExtensions(options.filters),
    });
    return { canceled: filePaths.length === 0, filePaths };
  },

  async showSaveDialog(options = {}) {
    const filePath = await getBackend().showSaveDialog({
      defaultName: options.defaultPath ?? '',
      extensions: flattenFilterExtensions(options.filters),
    });
    return { canceled: filePath.length === 0, filePath };
  },

  // Electron's showErrorBox is sync/void; surface it through the message-box
  // backend (an error-styled alert). Fire-and-forget on Linux (async dialog).
  showErrorBox(title, content) {
    void getBackend().showMessageBox({
      message: title,
      detail: content,
      buttons: ['OK'],
      type: 'error',
    });
  },
};

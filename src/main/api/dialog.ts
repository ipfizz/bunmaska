import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import * as cocoaDialog from '../platform/macos/cocoa-dialog';

/**
 * Native system dialogs — the drop-in equivalent of Electron's `dialog`.
 *
 * Methods return Promises to match Electron's async API, even though the macOS
 * backend runs the panels modally (synchronously) under the hood. The native
 * backend is injectable so the option-mapping and result-shaping logic is
 * unit-testable without showing a real dialog.
 */

export type MessageBoxOptions = {
  readonly message: string;
  readonly detail?: string;
  /** Button labels; defaults to `['OK']`. The first is the default button. */
  readonly buttons?: ReadonlyArray<string>;
};

export type MessageBoxReturnValue = {
  /** Index of the clicked button. */
  readonly response: number;
};

export type OpenDialogOptions = {
  /** Defaults to `['openFile']`. */
  readonly properties?: ReadonlyArray<'openFile' | 'openDirectory' | 'multiSelections'>;
};

export type OpenDialogReturnValue = {
  readonly canceled: boolean;
  readonly filePaths: string[];
};

export type SaveDialogOptions = {
  /** Suggested file name shown in the panel. */
  readonly defaultPath?: string;
};

export type SaveDialogReturnValue = {
  readonly canceled: boolean;
  readonly filePath: string;
};

/** The native backend the public dialog API delegates to. */
export type DialogBackend = {
  showMessageBox(spec: cocoaDialog.MessageBoxSpec): number;
  showOpenDialog(spec: cocoaDialog.OpenDialogSpec): string[];
  showSaveDialog(spec: cocoaDialog.SaveDialogSpec): string;
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
};

export const dialog: Dialog = {
  showMessageBox(options) {
    const response = getBackend().showMessageBox({
      message: options.message,
      detail: options.detail ?? '',
      buttons: options.buttons ?? ['OK'],
    });
    return Promise.resolve({ response });
  },

  showOpenDialog(options = {}) {
    const properties = options.properties ?? ['openFile'];
    const filePaths = getBackend().showOpenDialog({
      canChooseFiles: properties.includes('openFile'),
      canChooseDirectories: properties.includes('openDirectory'),
      allowsMultipleSelection: properties.includes('multiSelections'),
    });
    return Promise.resolve({ canceled: filePaths.length === 0, filePaths });
  },

  showSaveDialog(options = {}) {
    const filePath = getBackend().showSaveDialog({ defaultName: options.defaultPath ?? '' });
    return Promise.resolve({ canceled: filePath.length === 0, filePath });
  },
};

import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import { linuxDialogBackend } from '../platform/linux/gtk-dialog';
import * as cocoaDialog from '../platform/macos/cocoa-dialog';
import { windowsDialogBackend } from '../platform/windows/windows-dialog';

/**
 * Native system dialogs — the drop-in equivalent of Electron's `dialog`. macOS
 * and Windows run their panels modally while Linux is truly async
 * (`GAsyncReadyCallback`), so {@link DialogBackend} may return a value OR a
 * Promise.
 */

export type MessageBoxOptions = {
  readonly message: string;
  readonly detail?: string;
  /** Defaults to `['OK']`. The FIRST is the default button. */
  readonly buttons?: ReadonlyArray<string>;
  /** Styles the `NSAlert` icon on macOS; GtkAlertDialog has no severity, so a no-op on Linux. */
  readonly type?: cocoaDialog.MessageBoxType;
};

export type MessageBoxReturnValue = {
  /** Index into `buttons`. */
  readonly response: number;
};

/** `extensions` carry NO leading dot; `*` means any. */
export type FileFilter = {
  readonly name: string;
  readonly extensions: ReadonlyArray<string>;
};

export type OpenDialogOptions = {
  /**
   * Defaults to `['openFile']`. `createDirectory` (macOS) shows the panel's
   * "New Folder" button so the user can create a folder while picking.
   */
  readonly properties?: ReadonlyArray<
    'openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory'
  >;
  /** For a file path, the panel opens at its containing folder. */
  readonly defaultPath?: string;
  /** The selectable extensions are the UNION of every filter's. */
  readonly filters?: ReadonlyArray<FileFilter>;
};

export type OpenDialogReturnValue = {
  readonly canceled: boolean;
  readonly filePaths: string[];
};

export type SaveDialogOptions = {
  readonly defaultPath?: string;
  /** The allowed extensions are the UNION of every filter's. */
  readonly filters?: ReadonlyArray<FileFilter>;
};

/** Deduped, with the `*` wildcard dropped. */
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
  if (currentPlatform() === 'windows') {
    return windowsDialogBackend;
  }
  throw new UnsupportedPlatformError(`dialog is not supported on ${currentPlatform()} yet`);
};

/** @internal */
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
      canCreateDirectories: properties.includes('createDirectory'),
      defaultPath: options.defaultPath ?? '',
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

  // Electron's showErrorBox is sync/void, so this is fire-and-forget on Linux.
  showErrorBox(title, content) {
    void getBackend().showMessageBox({
      message: title,
      detail: content,
      buttons: ['OK'],
      type: 'error',
    });
  },
};

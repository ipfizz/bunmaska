import { createLogger } from '../../common/logger';
import { selectBackend } from '../platform/index';
import { linuxDialogBackend } from '../platform/linux/gtk-dialog';
import * as cocoaDialog from '../platform/macos/cocoa-dialog';
import { windowsDialogBackend } from '../platform/windows/windows-dialog';
import type { BrowserWindow } from './browser-window';

export type MessageBoxOptions = {
  readonly message: string;
  readonly detail?: string;
  /**
   * Defaults to `['OK']`; the first is the default. Windows ignores the labels and
   * shows OK, OK/Cancel or Yes/No/Cancel by count.
   */
  readonly buttons?: ReadonlyArray<string>;
  /** The alert icon on macOS and Windows; ignored on Linux (GtkAlertDialog has no severity). */
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
  /** Defaults to `['openFile']`. Linux v1 always picks one file; `createDirectory` is macOS only. */
  readonly properties?: ReadonlyArray<
    'openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory'
  >;
  /** macOS only: the folder to open in, or a file path's folder. Ignored on Linux and Windows. */
  readonly defaultPath?: string;
  /** The selectable extensions are the UNION of every filter's. */
  readonly filters?: ReadonlyArray<FileFilter>;
};

export type OpenDialogReturnValue = {
  readonly canceled: boolean;
  readonly filePaths: string[];
};

export type SaveDialogOptions = {
  /** A file name, or on Windows also a full path. */
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

/** macOS and Windows panels are modal and return a value; Linux (GTK) is async and returns a Promise. */
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

const { get: getBackend, setForTesting } = selectBackend<DialogBackend>('dialog', {
  macos: () => macosBackend,
  linux: () => linuxDialogBackend,
  windows: () => windowsDialogBackend,
});

/** @internal */
export const setDialogBackendForTesting = setForTesting;

const log = createLogger('dialog');

/** Electron's optional leading window: accepted, but the dialog is not attached as a sheet. */
type WithWindow<T> = [window: BrowserWindow, options: T];

export type Dialog = {
  showMessageBox(
    ...args: [options: MessageBoxOptions] | WithWindow<MessageBoxOptions>
  ): Promise<MessageBoxReturnValue>;
  showOpenDialog(
    ...args: [options?: OpenDialogOptions] | WithWindow<OpenDialogOptions>
  ): Promise<OpenDialogReturnValue>;
  showSaveDialog(
    ...args: [options?: SaveDialogOptions] | WithWindow<SaveDialogOptions>
  ): Promise<SaveDialogReturnValue>;
  showErrorBox(title: string, content: string): void;
};

export const dialog: Dialog = {
  async showMessageBox(...args) {
    const options = args.length === 2 ? args[1] : args[0];
    const response = await getBackend().showMessageBox({
      message: options.message,
      detail: options.detail ?? '',
      buttons: options.buttons ?? ['OK'],
      ...(options.type !== undefined ? { type: options.type } : {}),
    });
    return { response };
  },

  async showOpenDialog(...args) {
    const options = (args.length === 2 ? args[1] : args[0]) ?? {};
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

  async showSaveDialog(...args) {
    const options = (args.length === 2 ? args[1] : args[0]) ?? {};
    const filePath = await getBackend().showSaveDialog({
      defaultName: options.defaultPath ?? '',
      extensions: flattenFilterExtensions(options.filters),
    });
    return { canceled: filePath.length === 0, filePath };
  },

  // Electron's showErrorBox is sync and void, so an async failure is logged, never thrown.
  showErrorBox(title, content) {
    Promise.resolve(
      getBackend().showMessageBox({
        message: title,
        detail: content,
        buttons: ['OK'],
        type: 'error',
      }),
    ).catch((error: unknown) => log.warn('showErrorBox failed', error));
  },
};

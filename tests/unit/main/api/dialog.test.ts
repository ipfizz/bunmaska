import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  type DialogBackend,
  dialog,
  setDialogBackendForTesting,
} from '../../../../src/main/api/dialog';
import type {
  MessageBoxSpec,
  OpenDialogSpec,
  SaveDialogSpec,
} from '../../../../src/main/platform/macos/cocoa-dialog';

let lastMessageBox: MessageBoxSpec | undefined;
let lastOpen: OpenDialogSpec | undefined;
let lastSave: SaveDialogSpec | undefined;
let messageBoxResult = 0;
let openResult: string[] = [];
let saveResult = '';

beforeEach(() => {
  lastMessageBox = undefined;
  lastOpen = undefined;
  lastSave = undefined;
  messageBoxResult = 0;
  openResult = [];
  saveResult = '';
  const fake: DialogBackend = {
    showMessageBox: (spec) => {
      lastMessageBox = spec;
      return messageBoxResult;
    },
    showOpenDialog: (spec) => {
      lastOpen = spec;
      return openResult;
    },
    showSaveDialog: (spec) => {
      lastSave = spec;
      return saveResult;
    },
  };
  setDialogBackendForTesting(fake);
});

afterEach(() => {
  setDialogBackendForTesting(undefined);
});

describe('dialog.showMessageBox', () => {
  test('defaults detail to empty and buttons to [OK]', async () => {
    await dialog.showMessageBox({ message: 'Hello' });
    expect(lastMessageBox).toEqual({ message: 'Hello', detail: '', buttons: ['OK'] });
  });

  test('passes message, detail and buttons through', async () => {
    await dialog.showMessageBox({ message: 'm', detail: 'd', buttons: ['Yes', 'No'] });
    expect(lastMessageBox).toEqual({ message: 'm', detail: 'd', buttons: ['Yes', 'No'] });
  });

  test('returns the clicked button index as response', async () => {
    messageBoxResult = 1;
    expect(await dialog.showMessageBox({ message: 'm' })).toEqual({ response: 1 });
  });

  test('forwards the severity type to the backend', async () => {
    await dialog.showMessageBox({ message: 'm', type: 'warning' });
    expect(lastMessageBox?.type).toBe('warning');
  });

  test('omits type when not provided', async () => {
    await dialog.showMessageBox({ message: 'm' });
    expect(lastMessageBox?.type).toBeUndefined();
  });
});

describe('dialog.showOpenDialog', () => {
  test('defaults to a single-file picker', async () => {
    await dialog.showOpenDialog();
    expect(lastOpen).toEqual({
      canChooseFiles: true,
      canChooseDirectories: false,
      allowsMultipleSelection: false,
      extensions: [],
    });
  });

  test('maps properties to panel flags', async () => {
    await dialog.showOpenDialog({ properties: ['openDirectory', 'multiSelections'] });
    expect(lastOpen).toEqual({
      canChooseFiles: false,
      canChooseDirectories: true,
      allowsMultipleSelection: true,
      extensions: [],
    });
  });

  test('flattens filters into the union of extensions, dropping *', async () => {
    await dialog.showOpenDialog({
      filters: [
        { name: 'Images', extensions: ['png', 'jpg'] },
        { name: 'All', extensions: ['*'] },
      ],
    });
    expect(lastOpen?.extensions).toEqual(['png', 'jpg']);
  });

  test('reports canceled when no paths are returned', async () => {
    openResult = [];
    expect(await dialog.showOpenDialog()).toEqual({ canceled: true, filePaths: [] });
  });

  test('reports the chosen paths when not canceled', async () => {
    openResult = ['/a.txt', '/b.txt'];
    expect(await dialog.showOpenDialog()).toEqual({
      canceled: false,
      filePaths: ['/a.txt', '/b.txt'],
    });
  });
});

describe('dialog.showSaveDialog', () => {
  test('passes the default path as the default name', async () => {
    await dialog.showSaveDialog({ defaultPath: 'notes.md' });
    expect(lastSave).toEqual({ defaultName: 'notes.md', extensions: [] });
  });

  test('forwards filter extensions', async () => {
    await dialog.showSaveDialog({ filters: [{ name: 'Markdown', extensions: ['md'] }] });
    expect(lastSave?.extensions).toEqual(['md']);
  });

  test('reports canceled when no path is returned', async () => {
    saveResult = '';
    expect(await dialog.showSaveDialog()).toEqual({ canceled: true, filePath: '' });
  });

  test('reports the chosen path when not canceled', async () => {
    saveResult = '/home/notes.md';
    expect(await dialog.showSaveDialog()).toEqual({ canceled: false, filePath: '/home/notes.md' });
  });
});

describe('dialog.showErrorBox', () => {
  test('routes the title and content through an error-styled message box', () => {
    dialog.showErrorBox('Boom', 'Something failed');
    expect(lastMessageBox).toEqual({
      message: 'Boom',
      detail: 'Something failed',
      buttons: ['OK'],
      type: 'error',
    });
  });
});

describe('async DialogBackend (Promise-returning, e.g. Linux GTK)', () => {
  test('flattens a Promise<number> from showMessageBox without double-wrapping', async () => {
    const asyncBackend: DialogBackend = {
      showMessageBox: () => Promise.resolve(2),
      showOpenDialog: () => Promise.resolve([]),
      showSaveDialog: () => Promise.resolve(''),
    };
    setDialogBackendForTesting(asyncBackend);
    expect(await dialog.showMessageBox({ message: 'm' })).toEqual({ response: 2 });
  });

  test('flattens a Promise<string[]> from showOpenDialog', async () => {
    const asyncBackend: DialogBackend = {
      showMessageBox: () => Promise.resolve(0),
      showOpenDialog: () => Promise.resolve(['/picked.txt']),
      showSaveDialog: () => Promise.resolve(''),
    };
    setDialogBackendForTesting(asyncBackend);
    expect(await dialog.showOpenDialog()).toEqual({
      canceled: false,
      filePaths: ['/picked.txt'],
    });
  });

  test('flattens a Promise<string> from showSaveDialog', async () => {
    const asyncBackend: DialogBackend = {
      showMessageBox: () => Promise.resolve(0),
      showOpenDialog: () => Promise.resolve([]),
      showSaveDialog: () => Promise.resolve('/out.md'),
    };
    setDialogBackendForTesting(asyncBackend);
    expect(await dialog.showSaveDialog()).toEqual({ canceled: false, filePath: '/out.md' });
  });
});

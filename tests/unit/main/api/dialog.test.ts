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
});

describe('dialog.showOpenDialog', () => {
  test('defaults to a single-file picker', async () => {
    await dialog.showOpenDialog();
    expect(lastOpen).toEqual({
      canChooseFiles: true,
      canChooseDirectories: false,
      allowsMultipleSelection: false,
    });
  });

  test('maps properties to panel flags', async () => {
    await dialog.showOpenDialog({ properties: ['openDirectory', 'multiSelections'] });
    expect(lastOpen).toEqual({
      canChooseFiles: false,
      canChooseDirectories: true,
      allowsMultipleSelection: true,
    });
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
    expect(lastSave).toEqual({ defaultName: 'notes.md' });
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

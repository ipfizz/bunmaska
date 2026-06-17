import { afterEach, describe, expect, test } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../src/common/errors';
import { currentPlatform } from '../../../../src/common/platform';
import {
  type ClipboardBackend,
  clipboard,
  setClipboardBackendForTesting,
} from '../../../../src/main/api/clipboard';
import { nativeImage } from '../../../../src/main/api/native-image';

/** A backend fake with every method as a benign default; override per test. */
const makeFakeBackend = (overrides: Partial<ClipboardBackend> = {}): ClipboardBackend => ({
  readText: () => Promise.resolve(''),
  writeText: () => undefined,
  readHTML: () => Promise.resolve(''),
  writeHTML: () => undefined,
  readImage: () => new Uint8Array(0),
  writeImage: () => undefined,
  availableFormats: () => [],
  clear: () => undefined,
  ...overrides,
});

describe('clipboard export', () => {
  test('exposes readText, writeText, readHTML, writeHTML and clear', () => {
    expect(typeof clipboard.readText).toBe('function');
    expect(typeof clipboard.writeText).toBe('function');
    expect(typeof clipboard.readHTML).toBe('function');
    expect(typeof clipboard.writeHTML).toBe('function');
    expect(typeof clipboard.clear).toBe('function');
  });
});

describe('clipboard API with an injected backend (async readText contract)', () => {
  afterEach(() => {
    setClipboardBackendForTesting(undefined);
  });

  test('readText awaits the backend and resolves its value (Promise contract)', async () => {
    setClipboardBackendForTesting(
      makeFakeBackend({ readText: () => Promise.resolve('from-backend') }),
    );
    const result = clipboard.readText();
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBe('from-backend');
  });

  test('readText flattens a synchronously-returned string from the backend', async () => {
    setClipboardBackendForTesting(makeFakeBackend({ readText: () => 'sync-value' }));
    expect(await clipboard.readText()).toBe('sync-value');
  });

  test('writeText delegates synchronously to the backend', () => {
    const writes: string[] = [];
    setClipboardBackendForTesting(
      makeFakeBackend({
        writeText: (text) => {
          writes.push(text);
        },
      }),
    );
    const ret = clipboard.writeText('hello');
    expect(ret).toBeUndefined();
    expect(writes).toEqual(['hello']);
  });

  test('readHTML awaits the backend and resolves its value (Promise contract)', async () => {
    setClipboardBackendForTesting(
      makeFakeBackend({ readHTML: () => Promise.resolve('<b>hi</b>') }),
    );
    const result = clipboard.readHTML();
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBe('<b>hi</b>');
  });

  test('readHTML flattens a synchronously-returned string from the backend', async () => {
    setClipboardBackendForTesting(makeFakeBackend({ readHTML: () => '<i>sync</i>' }));
    expect(await clipboard.readHTML()).toBe('<i>sync</i>');
  });

  test('writeImage hands the image PNG bytes to the backend', () => {
    const writes: Uint8Array[] = [];
    setClipboardBackendForTesting(
      makeFakeBackend({
        writeImage: (bytes) => {
          writes.push(bytes);
        },
      }),
    );
    const png = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    );
    clipboard.writeImage(png);
    // The API hands the backend exactly the image's PNG bytes.
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual(png.toPNG());
  });

  test('readImage resolves an empty image when the clipboard holds no image', async () => {
    setClipboardBackendForTesting(makeFakeBackend({ readImage: () => new Uint8Array(0) }));
    expect((await clipboard.readImage()).isEmpty()).toBe(true);
  });

  test('availableFormats delegates to the backend', () => {
    setClipboardBackendForTesting(
      makeFakeBackend({ availableFormats: () => ['text/plain', 'image/png'] }),
    );
    expect(clipboard.availableFormats()).toEqual(['text/plain', 'image/png']);
  });

  test('writeHTML delegates synchronously to the backend', () => {
    const writes: string[] = [];
    setClipboardBackendForTesting(
      makeFakeBackend({
        writeHTML: (markup) => {
          writes.push(markup);
        },
      }),
    );
    const ret = clipboard.writeHTML('<p>x</p>');
    expect(ret).toBeUndefined();
    expect(writes).toEqual(['<p>x</p>']);
  });

  test('clear delegates synchronously to the backend', () => {
    let cleared = 0;
    setClipboardBackendForTesting(
      makeFakeBackend({
        clear: () => {
          cleared += 1;
        },
      }),
    );
    const ret = clipboard.clear();
    expect(ret).toBeUndefined();
    expect(cleared).toBe(1);
  });
});

if (currentPlatform() !== 'macos' && currentPlatform() !== 'linux') {
  describe('clipboard on platforms without a backend', () => {
    test('readText rejects with UnsupportedPlatformError', async () => {
      await expect(clipboard.readText()).rejects.toBeInstanceOf(UnsupportedPlatformError);
    });

    test('writeText throws UnsupportedPlatformError', () => {
      expect(() => clipboard.writeText('x')).toThrow(UnsupportedPlatformError);
    });

    test('readHTML rejects with UnsupportedPlatformError', async () => {
      await expect(clipboard.readHTML()).rejects.toBeInstanceOf(UnsupportedPlatformError);
    });

    test('writeHTML throws UnsupportedPlatformError', () => {
      expect(() => clipboard.writeHTML('<b>x</b>')).toThrow(UnsupportedPlatformError);
    });

    test('clear throws UnsupportedPlatformError', () => {
      expect(() => clipboard.clear()).toThrow(UnsupportedPlatformError);
    });
  });
}

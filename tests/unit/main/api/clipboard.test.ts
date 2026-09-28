import { afterEach, describe, expect, test } from 'bun:test';
import { clipboard, setClipboardBackendForTesting } from '../../../../src/main/api/clipboard';
import type { NativeImage } from '../../../../src/main/api/native-image';
import type { ClipboardBackend } from '../../../../src/main/platform/services';

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

describe('clipboard API with an injected backend (async readText contract)', () => {
  afterEach(() => {
    setClipboardBackendForTesting(undefined);
  });

  test('a synchronous backend throw on read becomes a rejection', async () => {
    const boom = (): never => {
      throw new Error('GdiplusStartup failed');
    };
    setClipboardBackendForTesting(
      makeFakeBackend({ readText: boom, readHTML: boom, readImage: boom }),
    );
    const reads = [clipboard.readText, clipboard.readHTML, clipboard.readImage].map((read) => {
      try {
        return read();
      } catch (error) {
        return error;
      }
    });
    for (const read of reads) {
      expect(read).toBeInstanceOf(Promise);
      await expect(read).rejects.toThrow('GdiplusStartup failed');
    }
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
    const image = { toPNG: () => Buffer.from([1, 2, 3]) } as unknown as NativeImage;
    clipboard.writeImage(image);
    expect(writes.map((bytes) => [...bytes])).toEqual([[1, 2, 3]]);
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

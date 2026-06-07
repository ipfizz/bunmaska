import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  type NativeImage,
  type NativeImageBackend,
  type NativeImageHandle,
  nativeImage,
  setNativeImageBackendForTesting,
} from '../../../../src/main/api/native-image';

/**
 * Unit tests for the pure `NativeImage` class against a FAKE backend, so the
 * class's plumbing (getSize, isEmpty, toDataURL base64, createEmpty) is
 * exercised on any host with no FFI.
 */

type Decoded = { handle: NativeImageHandle; width: number; height: number; empty: boolean };

let decodeCalls: Array<{ source: string | Uint8Array }>;
let encodeCalls: NativeImageHandle[];
let jpegCalls: Array<{ handle: NativeImageHandle; quality: number }>;

const makeFakeBackend = (decoded: Decoded, png: Uint8Array): NativeImageBackend => ({
  decode: (source) => {
    decodeCalls.push({ source });
    return decoded;
  },
  encodePng: (handle) => {
    encodeCalls.push(handle);
    return png;
  },
  encodeJpeg: (handle, quality) => {
    jpegCalls.push({ handle, quality });
    return new Uint8Array([0xff, 0xd8, 0xff]);
  },
});

beforeEach(() => {
  decodeCalls = [];
  encodeCalls = [];
  jpegCalls = [];
});

afterEach(() => {
  setNativeImageBackendForTesting(undefined);
});

describe('nativeImage factory', () => {
  test('createFromPath decodes via the backend and reports the decoded size', () => {
    const handle: NativeImageHandle = 42n;
    setNativeImageBackendForTesting(
      makeFakeBackend({ handle, width: 7, height: 3, empty: false }, new Uint8Array([1])),
    );
    const image = nativeImage.createFromPath('/tmp/x.png');
    expect(image.getSize()).toEqual({ width: 7, height: 3 });
    expect(image.isEmpty()).toBe(false);
    expect(decodeCalls).toHaveLength(1);
    expect(decodeCalls[0]?.source).toBe('/tmp/x.png');
  });

  test('createFromBuffer passes the raw bytes to the backend decode', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    setNativeImageBackendForTesting(
      makeFakeBackend({ handle: 1n, width: 2, height: 2, empty: false }, new Uint8Array([1])),
    );
    nativeImage.createFromBuffer(bytes);
    expect(decodeCalls).toHaveLength(1);
    expect(decodeCalls[0]?.source).toBe(bytes);
  });

  test('createEmpty is empty, has zero size, and never touches the backend', () => {
    setNativeImageBackendForTesting(
      makeFakeBackend({ handle: 9n, width: 5, height: 5, empty: false }, new Uint8Array([1])),
    );
    const image = nativeImage.createEmpty();
    expect(image.isEmpty()).toBe(true);
    expect(image.getSize()).toEqual({ width: 0, height: 0 });
    expect(decodeCalls).toHaveLength(0);
  });
});

describe('NativeImage.isEmpty', () => {
  test('is true when the backend reports the decode produced an empty image', () => {
    setNativeImageBackendForTesting(
      makeFakeBackend({ handle: 0n, width: 0, height: 0, empty: true }, new Uint8Array([1])),
    );
    const image = nativeImage.createFromPath('/does/not/exist.png');
    expect(image.isEmpty()).toBe(true);
    expect(image.getSize()).toEqual({ width: 0, height: 0 });
  });
});

describe('NativeImage.toPNG', () => {
  test('returns the bytes the backend encodes', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    setNativeImageBackendForTesting(
      makeFakeBackend({ handle: 7n, width: 1, height: 1, empty: false }, png),
    );
    const image = nativeImage.createFromPath('/tmp/x.png');
    expect(Array.from(image.toPNG())).toEqual(Array.from(png));
    expect(encodeCalls).toEqual([7n]);
  });

  test('returns an empty buffer for an empty image without calling encode', () => {
    setNativeImageBackendForTesting(
      makeFakeBackend({ handle: 0n, width: 0, height: 0, empty: true }, new Uint8Array([1])),
    );
    const image = nativeImage.createEmpty();
    expect(image.toPNG().length).toBe(0);
    expect(encodeCalls).toHaveLength(0);
  });
});

describe('NativeImage.toDataURL', () => {
  test('base64-encodes the PNG bytes behind the data: scheme', () => {
    // The PNG signature bytes encode to "iVBORw0KGgo=" in base64.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    setNativeImageBackendForTesting(
      makeFakeBackend({ handle: 1n, width: 1, height: 1, empty: false }, png),
    );
    const image = nativeImage.createFromPath('/tmp/x.png');
    const url = image.toDataURL();
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    const base64 = url.slice('data:image/png;base64,'.length);
    expect(base64).toBe(Buffer.from(png).toString('base64'));
    expect(base64).toBe('iVBORw0KGgo=');
  });

  test('returns an empty-payload data URL for an empty image', () => {
    setNativeImageBackendForTesting(
      makeFakeBackend({ handle: 0n, width: 0, height: 0, empty: true }, new Uint8Array([1])),
    );
    const url = nativeImage.createEmpty().toDataURL();
    expect(url).toBe('data:image/png;base64,');
  });
});

describe('NativeImage type', () => {
  test('exposes the Electron-compatible instance surface', () => {
    setNativeImageBackendForTesting(
      makeFakeBackend({ handle: 1n, width: 1, height: 1, empty: false }, new Uint8Array([1])),
    );
    const image: NativeImage = nativeImage.createEmpty();
    expect(typeof image.getSize).toBe('function');
    expect(typeof image.isEmpty).toBe('function');
    expect(typeof image.toPNG).toBe('function');
    expect(typeof image.toDataURL).toBe('function');
  });
});

describe('NativeImage.toJPEG', () => {
  test('encodes via the backend at the given quality', () => {
    setNativeImageBackendForTesting(
      makeFakeBackend({ handle: 9n, width: 2, height: 2, empty: false }, new Uint8Array([1])),
    );
    const bytes = nativeImage.createFromBuffer(new Uint8Array([1])).toJPEG(70);
    expect(jpegCalls).toEqual([{ handle: 9n, quality: 70 }]);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0xff, 0xd8]);
  });

  test('returns an empty buffer for an empty image (no backend call)', () => {
    setNativeImageBackendForTesting(
      makeFakeBackend({ handle: 0n, width: 0, height: 0, empty: true }, new Uint8Array([1])),
    );
    expect(nativeImage.createEmpty().toJPEG().length).toBe(0);
    expect(jpegCalls).toHaveLength(0);
  });
});

describe('nativeImage.createFromDataURL', () => {
  test('base64-decodes the payload and decodes the bytes via the backend', () => {
    setNativeImageBackendForTesting(
      makeFakeBackend({ handle: 1n, width: 1, height: 1, empty: false }, new Uint8Array([1])),
    );
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const base64 = Buffer.from(bytes).toString('base64');
    nativeImage.createFromDataURL(`data:image/png;base64,${base64}`);
    expect(decodeCalls).toHaveLength(1);
    expect(decodeCalls[0]?.source).toEqual(bytes);
  });

  test('a malformed data URL yields an empty image without a backend decode', () => {
    setNativeImageBackendForTesting(
      makeFakeBackend({ handle: 1n, width: 1, height: 1, empty: false }, new Uint8Array([1])),
    );
    expect(nativeImage.createFromDataURL('not-a-data-url').isEmpty()).toBe(true);
    expect(decodeCalls).toHaveLength(0);
  });
});

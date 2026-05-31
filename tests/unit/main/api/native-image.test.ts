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

const makeFakeBackend = (decoded: Decoded, png: Uint8Array): NativeImageBackend => ({
  decode: (source) => {
    decodeCalls.push({ source });
    return decoded;
  },
  encodePng: (handle) => {
    encodeCalls.push(handle);
    return png;
  },
});

beforeEach(() => {
  decodeCalls = [];
  encodeCalls = [];
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

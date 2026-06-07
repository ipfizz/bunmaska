import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import { cocoaNativeImageBackend } from '../platform/macos/cocoa-native-image';
import { gdkNativeImageBackend } from '../platform/linux/gdk-native-image';

/**
 * Image loading, querying, and encoding — a drop-in subset of Electron's
 * `nativeImage` module.
 *
 * The public {@link NativeImage} class is pure TypeScript: it holds a decoded
 * image's dimensions, emptiness, and an opaque native handle, and derives
 * `toDataURL` from the backend's `toPNG` bytes. All native work (decoding a
 * file/buffer, reading pixel dimensions, encoding PNG) lives behind an
 * injectable {@link NativeImageBackend}, so the class plumbing is unit-testable
 * on any host with a fake and the FFI is confined to the per-platform backends.
 *
 * SIZE — bun:ffi cannot return a struct by value, so Electron's `NSImage.size`
 * (an `NSSize` struct) is unreadable across the FFI boundary. Instead each
 * backend reports `width`/`height` via SCALAR getters at decode time (macOS
 * `NSBitmapImageRep` `pixelsWide`/`pixelsHigh`, both `NSInteger`; Linux
 * `gdk_pixbuf_get_width`/`get_height`, both `int`), which `getSize` returns
 * directly. No struct ever crosses FFI.
 *
 * V1 surface: `createFromPath`, `createFromBuffer` (PNG/JPEG bytes),
 * `createFromDataURL`, `createEmpty`; instance `getSize`, `isEmpty`, `toPNG`,
 * `toJPEG`, `toDataURL`. `toJPEG`'s quality is honored on macOS; Linux v1 uses
 * GdkPixbuf's default quality (option-key arrays are a follow-up). DEFERRED
 * (documented, not stubbed as fake no-ops): `resize`, `crop`,
 * `getScaleFactors`/`getAspectRatio`, template-image flags, `{ scaleFactor }`.
 */

/** An opaque native image handle, carried as a `bigint` (macOS) or `Pointer` bigint (Linux). */
export type NativeImageHandle = bigint;

/** The result of decoding an image source: a native handle plus scalar metadata. */
export type DecodedImage = {
  /** The native image handle (`0n` when empty / decode failed). */
  readonly handle: NativeImageHandle;
  /** Pixel width via a SCALAR getter (`0` when empty). */
  readonly width: number;
  /** Pixel height via a SCALAR getter (`0` when empty). */
  readonly height: number;
  /** Whether the decode produced no usable image (bad path / undecodable bytes). */
  readonly empty: boolean;
};

/**
 * The native backend the public `nativeImage` API delegates to. Injectable so
 * the pure {@link NativeImage} plumbing is unit-testable without FFI.
 */
export type NativeImageBackend = {
  /** Decode a filesystem path or in-memory PNG/JPEG bytes into a native image. */
  decode(source: string | Uint8Array): DecodedImage;
  /** Encode a decoded image's native handle to PNG bytes. */
  encodePng(handle: NativeImageHandle): Uint8Array;
  /** Encode to JPEG bytes at `quality` (0–100). */
  encodeJpeg(handle: NativeImageHandle, quality: number): Uint8Array;
};

const DATA_URL_PREFIX = 'data:image/png;base64,';

/**
 * A loaded image — the drop-in equivalent of Electron's `NativeImage`. Created
 * through the {@link nativeImage} factory, never directly.
 */
export class NativeImage {
  readonly #backend: NativeImageBackend;
  readonly #handle: NativeImageHandle;
  readonly #width: number;
  readonly #height: number;
  readonly #empty: boolean;

  /** @internal Constructed by the factory from a decoded image + its backend. */
  constructor(backend: NativeImageBackend, decoded: DecodedImage) {
    this.#backend = backend;
    this.#handle = decoded.handle;
    this.#width = decoded.empty ? 0 : decoded.width;
    this.#height = decoded.empty ? 0 : decoded.height;
    this.#empty = decoded.empty;
  }

  /** The image's pixel dimensions ( `{ width: 0, height: 0 }` when empty). */
  getSize(): { width: number; height: number } {
    return { width: this.#width, height: this.#height };
  }

  /** Whether the image has no usable contents (bad path / undecodable bytes / created empty). */
  isEmpty(): boolean {
    return this.#empty;
  }

  /** Encode the image to PNG bytes. Returns an empty buffer for an empty image. */
  toPNG(): Uint8Array {
    if (this.#empty) {
      return new Uint8Array(0);
    }
    return this.#backend.encodePng(this.#handle);
  }

  /** Encode the image to JPEG bytes at `quality` (0–100). Empty buffer when empty. */
  toJPEG(quality = 92): Uint8Array {
    if (this.#empty) {
      return new Uint8Array(0);
    }
    return this.#backend.encodeJpeg(this.#handle, quality);
  }

  /** The image as a `data:image/png;base64,...` URL (empty payload when empty). */
  toDataURL(): string {
    return `${DATA_URL_PREFIX}${Buffer.from(this.toPNG()).toString('base64')}`;
  }
}

let backend: NativeImageBackend | undefined;

const getBackend = (): NativeImageBackend => {
  if (backend !== undefined) {
    return backend;
  }
  if (currentPlatform() === 'macos') {
    return cocoaNativeImageBackend;
  }
  if (currentPlatform() === 'linux') {
    return gdkNativeImageBackend;
  }
  throw new UnsupportedPlatformError(`nativeImage is not supported on ${currentPlatform()} yet`);
};

/** Override the native image backend. Test-only. */
export const setNativeImageBackendForTesting = (fake: NativeImageBackend | undefined): void => {
  backend = fake;
};

/** An always-empty decode, used by {@link nativeImage.createEmpty} (no backend call). */
const EMPTY_DECODE: DecodedImage = { handle: 0n, width: 0, height: 0, empty: true };

/** The `nativeImage` module — Electron-compatible image load/query/encode. */
export const nativeImage = {
  /** Load an image from a filesystem path. A bad/unreadable path yields an empty image. */
  createFromPath(path: string): NativeImage {
    const b = getBackend();
    return new NativeImage(b, b.decode(path));
  },
  /** Decode in-memory PNG/JPEG bytes. Undecodable bytes yield an empty image. */
  createFromBuffer(buffer: Uint8Array): NativeImage {
    const b = getBackend();
    return new NativeImage(b, b.decode(buffer));
  },
  /** Decode a `data:` URL (base64 or URL-encoded). A malformed URL yields an empty image. */
  createFromDataURL(dataURL: string): NativeImage {
    const comma = dataURL.indexOf(',');
    if (comma === -1 || !dataURL.startsWith('data:')) {
      return this.createEmpty();
    }
    const meta = dataURL.slice('data:'.length, comma);
    const payload = dataURL.slice(comma + 1);
    const bytes = meta.includes(';base64')
      ? new Uint8Array(Buffer.from(payload, 'base64'))
      : new TextEncoder().encode(decodeURIComponent(payload));
    return this.createFromBuffer(bytes);
  },
  /** Create an empty image (no native decode). */
  createEmpty(): NativeImage {
    return new NativeImage(getBackend(), EMPTY_DECODE);
  },
};

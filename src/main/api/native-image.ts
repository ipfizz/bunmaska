import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import { gdkNativeImageBackend } from '../platform/linux/gdk-native-image';
import { cocoaNativeImageBackend } from '../platform/macos/cocoa-native-image';
import { windowsNativeImageBackend } from '../platform/windows/windows-native-image';

/**
 * Image loading, querying, and encoding — a drop-in subset of Electron's
 * `nativeImage` module.
 *
 * SIZE — bun:ffi cannot return a struct by value, so Electron's `NSImage.size`
 * (an `NSSize` struct) is unreadable across the FFI boundary. Instead each
 * backend reports `width`/`height` via SCALAR getters at decode time (macOS
 * `NSBitmapImageRep` `pixelsWide`/`pixelsHigh`, both `NSInteger`; Linux
 * `gdk_pixbuf_get_width`/`get_height`, both `int`; Windows GDI+), which `getSize`
 * returns directly. No struct ever crosses FFI.
 *
 * The template flag is plain JS metadata: the macOS `NSImage setTemplate:` is
 * applied when the image is realized for a `Tray`/menu, not on the decoded rep
 * here. `toJPEG`'s quality is honored on macOS; Linux uses GdkPixbuf's default.
 * `getScaleFactors` and `{ scaleFactor }` are deferred, not stubbed.
 */

/** Opaque: an ObjC object address (macOS) or a `Pointer` (Linux), both as `bigint`. */
export type NativeImageHandle = bigint;

export type DecodedImage = {
  /** `0n` when empty or the decode failed. */
  readonly handle: NativeImageHandle;
  /** Pixel width via a SCALAR getter; `0` when empty. */
  readonly width: number;
  /** Pixel height via a SCALAR getter; `0` when empty. */
  readonly height: number;
  /** Set for a bad path or undecodable bytes. */
  readonly empty: boolean;
};

export type NativeImageBackend = {
  /** A filesystem path or in-memory PNG/JPEG bytes. */
  decode(source: string | Uint8Array): DecodedImage;
  encodePng(handle: NativeImageHandle): Uint8Array;
  /** `quality` is 0-100. */
  encodeJpeg(handle: NativeImageHandle, quality: number): Uint8Array;
  /** Redraws at exactly `width`×`height` px into a NEW native image. */
  resize(handle: NativeImageHandle, width: number, height: number): DecodedImage;
  /** Copies the sub-rectangle into a NEW native image. */
  crop(
    handle: NativeImageHandle,
    x: number,
    y: number,
    width: number,
    height: number,
  ): DecodedImage;
};

/** Preserves aspect ratio when one dimension is omitted. */
export const resolveResizeDimensions = (
  srcW: number,
  srcH: number,
  width?: number,
  height?: number,
): { width: number; height: number } => {
  const hasW = typeof width === 'number' && width > 0;
  const hasH = typeof height === 'number' && height > 0;
  if (hasW && hasH) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  if (hasW) {
    return { width: Math.round(width), height: Math.max(1, Math.round((width / srcW) * srcH)) };
  }
  if (hasH) {
    return { width: Math.max(1, Math.round((height / srcH) * srcW)), height: Math.round(height) };
  }
  return { width: srcW, height: srcH }; // both omitted → unchanged size
};

/** `undefined` when the clamped rect is empty. */
export const clampCropRect = (
  imgW: number,
  imgH: number,
  rect: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } | undefined => {
  const x = Math.max(0, Math.min(Math.round(rect.x), imgW));
  const y = Math.max(0, Math.min(Math.round(rect.y), imgH));
  const width = Math.min(Math.round(rect.width), imgW - x);
  const height = Math.min(Math.round(rect.height), imgH - y);
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
};

const DATA_URL_PREFIX = 'data:image/png;base64,';

/** Created through the {@link nativeImage} factory, never directly. */
export class NativeImage {
  readonly #backend: NativeImageBackend;
  readonly #handle: NativeImageHandle;
  readonly #width: number;
  readonly #height: number;
  readonly #empty: boolean;
  #template = false;

  /** @internal */
  constructor(backend: NativeImageBackend, decoded: DecodedImage) {
    this.#backend = backend;
    this.#handle = decoded.handle;
    this.#width = decoded.empty ? 0 : decoded.width;
    this.#height = decoded.empty ? 0 : decoded.height;
    this.#empty = decoded.empty;
  }

  /** Pixel dimensions; `{ width: 0, height: 0 }` when empty. */
  getSize(): { width: number; height: number } {
    return { width: this.#width, height: this.#height };
  }

  /** True for a bad path, undecodable bytes, or `createEmpty`. */
  isEmpty(): boolean {
    return this.#empty;
  }

  /** Width over height; `0` when empty or zero-height. */
  getAspectRatio(): number {
    return this.#height === 0 ? 0 : this.#width / this.#height;
  }

  /** A zero-length `Buffer` when the image is empty. */
  toPNG(): Buffer {
    if (this.#empty) {
      return Buffer.alloc(0);
    }
    return Buffer.from(this.#backend.encodePng(this.#handle));
  }

  /** `quality` is 0-100, default 92. A zero-length `Buffer` when the image is empty. */
  toJPEG(quality = 92): Buffer {
    if (this.#empty) {
      return Buffer.alloc(0);
    }
    return Buffer.from(this.#backend.encodeJpeg(this.#handle, quality));
  }

  /** Always PNG, whatever the source format. */
  toDataURL(): string {
    return `${DATA_URL_PREFIX}${Buffer.from(this.toPNG()).toString('base64')}`;
  }

  /**
   * Omitting one dimension preserves aspect ratio; omitting both returns an
   * unchanged-size copy. `quality` is accepted for Electron compatibility and
   * honored only where the backend supports it.
   */
  resize(options: {
    width?: number;
    height?: number;
    quality?: 'good' | 'better' | 'best';
  }): NativeImage {
    if (this.#empty) {
      return new NativeImage(this.#backend, EMPTY_DECODE);
    }
    const { width, height } = resolveResizeDimensions(
      this.#width,
      this.#height,
      options.width,
      options.height,
    );
    if (width <= 0 || height <= 0) {
      return new NativeImage(this.#backend, EMPTY_DECODE);
    }
    return new NativeImage(this.#backend, this.#backend.resize(this.#handle, width, height));
  }

  /**
   * `rect` is in px with a top-left origin. A rect entirely outside the image
   * yields an empty image; a partially-overflowing one is clamped to bounds.
   */
  crop(rect: { x: number; y: number; width: number; height: number }): NativeImage {
    if (this.#empty) {
      return new NativeImage(this.#backend, EMPTY_DECODE);
    }
    const clamped = clampCropRect(this.#width, this.#height, rect);
    if (clamped === undefined) {
      return new NativeImage(this.#backend, EMPTY_DECODE);
    }
    return new NativeImage(
      this.#backend,
      this.#backend.crop(this.#handle, clamped.x, clamped.y, clamped.width, clamped.height),
    );
  }

  /** A template is a monochrome icon the OS recolors for light/dark. */
  setTemplateImage(option: boolean): void {
    this.#template = option;
  }

  isTemplateImage(): boolean {
    return this.#template;
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
  if (currentPlatform() === 'windows') {
    return windowsNativeImageBackend;
  }
  throw new UnsupportedPlatformError(`nativeImage is not supported on ${currentPlatform()} yet`);
};

/** @internal */
export const setNativeImageBackendForTesting = (fake: NativeImageBackend | undefined): void => {
  backend = fake;
};

const EMPTY_DECODE: DecodedImage = { handle: 0n, width: 0, height: 0, empty: true };

/** The `nativeImage` module — Electron-compatible image load/query/encode. */
export const nativeImage = {
  /** A bad or unreadable path yields an empty image, not a throw. */
  createFromPath(path: string): NativeImage {
    const b = getBackend();
    return new NativeImage(b, b.decode(path));
  },
  /** Undecodable bytes yield an empty image, not a throw. */
  createFromBuffer(buffer: Uint8Array): NativeImage {
    const b = getBackend();
    return new NativeImage(b, b.decode(buffer));
  },
  /** Base64 or URL-encoded. A malformed URL yields an empty image. */
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
  /** No native decode is performed. */
  createEmpty(): NativeImage {
    return new NativeImage(getBackend(), EMPTY_DECODE);
  },
};

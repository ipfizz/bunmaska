import { service } from '../platform/index';
import type { DecodedImage, NativeImageBackend, NativeImageHandle } from '../platform/services';

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
  return { width: srcW, height: srcH };
};

/** The rect's intersection with the image; `undefined` when empty. */
export const clampCropRect = (
  imgW: number,
  imgH: number,
  rect: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } | undefined => {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const width = Math.min(imgW, Math.round(rect.x) + Math.round(rect.width)) - x;
  const height = Math.min(imgH, Math.round(rect.y) + Math.round(rect.height)) - y;
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
};

const DATA_URL_PREFIX = 'data:image/png;base64,';

// The held value must never reference the image, or the image is never collected.
const releaser = new FinalizationRegistry<{
  readonly backend: NativeImageBackend;
  readonly handle: NativeImageHandle;
}>(({ backend, handle }) => backend.release?.(handle));

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
    if (decoded.handle !== 0n) {
      releaser.register(this, { backend, handle: decoded.handle });
    }
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

  /** `quality` is 0-100, default 92, ignored on Windows. Zero-length when the image is empty. */
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

  /** `rect` is in px, top-left origin, and clipped to the image; no overlap yields an empty image. */
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

  /** A monochrome icon the OS recolors for light/dark; applied when a Tray or menu uses it. */
  setTemplateImage(option: boolean): void {
    this.#template = option;
  }

  isTemplateImage(): boolean {
    return this.#template;
  }
}

const { get: getBackend, setForTesting } = service('nativeImage');

/** @internal */
export const setNativeImageBackendForTesting = setForTesting;

const EMPTY_DECODE: DecodedImage = { handle: 0n, width: 0, height: 0, empty: true };

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
      return nativeImage.createEmpty();
    }
    const meta = dataURL.slice('data:'.length, comma);
    const payload = dataURL.slice(comma + 1);
    // Percent-escapes are raw bytes: decodeURIComponent throws on non-UTF-8 like `%89`.
    const bytes = meta.includes(';base64')
      ? Buffer.from(payload, 'base64')
      : Buffer.from(
          payload.replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
            String.fromCharCode(Number.parseInt(hex, 16)),
          ),
          'latin1',
        );
    return nativeImage.createFromBuffer(new Uint8Array(bytes));
  },
  /** No native decode is performed. */
  createEmpty(): NativeImage {
    return new NativeImage(getBackend(), EMPTY_DECODE);
  },
};

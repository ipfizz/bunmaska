import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import { linuxClipboardBackend } from '../platform/linux/gtk-clipboard';
import * as macosClipboard from '../platform/macos/cocoa-clipboard';
import { type NativeImage, nativeImage } from './native-image';

/**
 * System clipboard access — the drop-in equivalent of Electron's `clipboard`.
 *
 * A process-wide singleton (not tied to a window), mirroring Electron. Covers
 * plain text on macOS and Linux (GTK 4). Methods throw
 * {@link UnsupportedPlatformError} on platforms without a backend rather than
 * silently no-op'ing.
 *
 * `readText` is asynchronous on BOTH platforms (returns a `Promise<string>`): a
 * deliberate uniform contract, since GDK 4's clipboard read is async-only. The
 * macOS backend reads synchronously under the hood and resolves the value.
 * `writeText`/`clear` stay synchronous on both platforms.
 */

export type Clipboard = {
  /** Read the clipboard's plain-text contents, or `''` if it holds no text. */
  readText(): Promise<string>;
  /** Replace the clipboard's contents with `text` as plain text. */
  writeText(text: string): void;
  /** Read the clipboard's HTML markup, or `''` if it holds no HTML. */
  readHTML(): Promise<string>;
  /** Replace the clipboard's contents with `markup` as HTML. */
  writeHTML(markup: string): void;
  /** Read the clipboard's image (an empty {@link NativeImage} if it holds none). */
  readImage(): Promise<NativeImage>;
  /** Replace the clipboard's contents with `image` (written as PNG). */
  writeImage(image: NativeImage): void;
  /** The format names (MIME types) currently on the clipboard. */
  availableFormats(): string[];
  /** Clear the clipboard. */
  clear(): void;
};

/**
 * The native backend the public clipboard API delegates to.
 *
 * `readText` may return its value synchronously (a string) or as a Promise; the
 * API's `Promise.resolve(...)` flattens both into the uniform `Promise<string>`
 * contract. `writeText`/`clear` are synchronous on every platform. The backend
 * is injectable so the dispatch logic is unit-testable without a real clipboard.
 */
export type ClipboardBackend = {
  readText(): string | Promise<string>;
  writeText(text: string): void;
  readHTML(): string | Promise<string>;
  writeHTML(markup: string): void;
  /** PNG image bytes, or an empty array if the clipboard holds no image. */
  readImage(): Uint8Array | Promise<Uint8Array>;
  /** Write PNG image `bytes` to the clipboard. */
  writeImage(bytes: Uint8Array): void;
  /** The MIME format names currently on the clipboard. */
  availableFormats(): string[];
  clear(): void;
};

const macosBackend: ClipboardBackend = {
  readText: () => macosClipboard.readText(),
  writeText: (text) => macosClipboard.writeText(text),
  readHTML: () => macosClipboard.readHTML(),
  writeHTML: (markup) => macosClipboard.writeHTML(markup),
  readImage: () => macosClipboard.readImage(),
  writeImage: (bytes) => macosClipboard.writeImage(bytes),
  availableFormats: () => macosClipboard.availableFormats(),
  clear: () => macosClipboard.clear(),
};

let backend: ClipboardBackend | undefined;

const getBackend = (): ClipboardBackend => {
  if (backend !== undefined) {
    return backend;
  }
  if (currentPlatform() === 'macos') {
    return macosBackend;
  }
  if (currentPlatform() === 'linux') {
    return linuxClipboardBackend;
  }
  throw new UnsupportedPlatformError(`clipboard is not supported on ${currentPlatform()} yet`);
};

/** Override the native clipboard backend. Test-only. */
export const setClipboardBackendForTesting = (fake: ClipboardBackend | undefined): void => {
  backend = fake;
};

export const clipboard: Clipboard = {
  // `Promise.resolve` flattens a sync string (macOS) or a Promise (Linux/macOS
  // wrapper) uniformly into the async contract without double-wrapping.
  readText() {
    return Promise.resolve(getBackend().readText());
  },
  writeText(text) {
    getBackend().writeText(text);
  },
  readHTML() {
    return Promise.resolve(getBackend().readHTML());
  },
  writeHTML(markup) {
    getBackend().writeHTML(markup);
  },
  readImage() {
    return Promise.resolve(getBackend().readImage()).then((png) =>
      png.length === 0 ? nativeImage.createEmpty() : nativeImage.createFromBuffer(png),
    );
  },
  writeImage(image) {
    getBackend().writeImage(image.toPNG());
  },
  availableFormats() {
    return getBackend().availableFormats();
  },
  clear() {
    getBackend().clear();
  },
};

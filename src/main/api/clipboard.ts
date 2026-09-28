import { selectBackend } from '../platform/index';
import { linuxClipboardBackend } from '../platform/linux/gtk-clipboard';
import * as macosClipboard from '../platform/macos/cocoa-clipboard';
import { windowsClipboardBackend } from '../platform/windows/windows-clipboard';
import { type NativeImage, nativeImage } from './native-image';
import type { ClipboardBackend } from '../platform/services';

/** Reads are async everywhere because GDK 4 can only read async (D033); Electron's are sync. */
export type Clipboard = {
  /** `''` if the clipboard holds no text. */
  readText(): Promise<string>;
  writeText(text: string): void;
  /** `''` if the clipboard holds no HTML. */
  readHTML(): Promise<string>;
  writeHTML(markup: string): void;
  /** An empty {@link NativeImage} if the clipboard holds no image. */
  readImage(): Promise<NativeImage>;
  /** Written as PNG. */
  writeImage(image: NativeImage): void;
  /** MIME type names. */
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

const { get: getBackend, setForTesting } = selectBackend<ClipboardBackend>('clipboard', {
  macos: () => macosBackend,
  linux: () => linuxClipboardBackend,
  windows: () => windowsClipboardBackend,
});

/** @internal */
export const setClipboardBackendForTesting = setForTesting;

export const clipboard: Clipboard = {
  async readText() {
    return getBackend().readText();
  },
  writeText(text) {
    getBackend().writeText(text);
  },
  async readHTML() {
    return getBackend().readHTML();
  },
  writeHTML(markup) {
    getBackend().writeHTML(markup);
  },
  async readImage() {
    const png = await getBackend().readImage();
    return png.length === 0 ? nativeImage.createEmpty() : nativeImage.createFromBuffer(png);
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

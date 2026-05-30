import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import * as macosClipboard from '../platform/macos/cocoa-clipboard';

/**
 * System clipboard access — the drop-in equivalent of Electron's `clipboard`.
 *
 * A process-wide singleton (not tied to a window), mirroring Electron. Today it
 * covers plain text on macOS; Linux clipboard support arrives with the GTK
 * backend. Methods throw {@link UnsupportedPlatformError} on platforms without a
 * backend rather than silently no-op'ing.
 */

const unsupported = (method: string): never => {
  throw new UnsupportedPlatformError(
    `clipboard.${method} is not supported on ${currentPlatform()} yet`,
  );
};

export type Clipboard = {
  /** Read the clipboard's plain-text contents, or `''` if it holds no text. */
  readText(): string;
  /** Replace the clipboard's contents with `text` as plain text. */
  writeText(text: string): void;
  /** Clear the clipboard. */
  clear(): void;
};

export const clipboard: Clipboard = {
  readText() {
    return currentPlatform() === 'macos' ? macosClipboard.readText() : unsupported('readText');
  },
  writeText(text) {
    if (currentPlatform() !== 'macos') {
      unsupported('writeText');
    }
    macosClipboard.writeText(text);
  },
  clear() {
    if (currentPlatform() !== 'macos') {
      unsupported('clear');
    }
    macosClipboard.clear();
  },
};

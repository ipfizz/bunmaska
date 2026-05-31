import { EventEmitter } from 'node:events';
import { isAbsolute, resolve } from 'node:path';
import { createLogger } from '../../common/logger';
import { decodeEnvelope, encodeEnvelope } from '../ipc/ipc-protocol';
import type { NativeWebContents } from '../platform/native';
import { ipcMain } from './ipc-main';

/**
 * Controls and observes the content rendered inside a {@link BrowserWindow} —
 * the drop-in equivalent of Electron's `webContents`. Content methods on
 * `BrowserWindow` delegate here (D025). Extends Node {@link EventEmitter}.
 *
 * On construction it bridges the native web view to the {@link ipcMain}
 * singleton: inbound renderer envelopes are routed to `ipcMain`, and any reply
 * is sent back to the renderer — so `ipcMain.handle` + `ipcRenderer.invoke`
 * work end-to-end with no per-window wiring.
 */

const log = createLogger('web-contents');

let nextId = 1;

/** Reset the id counter. Test-only. */
export const resetWebContentsIdsForTesting = (): void => {
  nextId = 1;
};

export class WebContents extends EventEmitter {
  /** Process-unique id, matching Electron's `webContents.id`. */
  readonly id: number;
  readonly #native: NativeWebContents;

  constructor(native: NativeWebContents) {
    super();
    this.id = nextId;
    nextId += 1;
    this.#native = native;
    this.#native.onRendererEnvelope((json) => {
      void this.#handleRendererEnvelope(json);
    });
    this.#native.onDidFinishLoad(() => {
      this.emit('did-finish-load');
    });
  }

  /** Navigate to a URL. */
  loadURL(url: string): void {
    this.#native.loadURL(url);
  }

  /** Load a local file by path. */
  loadFile(filePath: string): void {
    const absolute = isAbsolute(filePath) ? filePath : resolve(filePath);
    this.#native.loadURL(`file://${absolute}`);
  }

  /** The current page URL, or `''` before the first navigation. */
  getURL(): string {
    return this.#native.getURL();
  }

  /** Reload the current page. */
  reload(): void {
    this.#native.reload();
  }

  /** Navigate back one entry in the session history, if possible. */
  goBack(): void {
    this.#native.goBack();
  }

  /** Navigate forward one entry in the session history, if possible. */
  goForward(): void {
    this.#native.goForward();
  }

  /** Whether there is a previous history entry to go back to. */
  canGoBack(): boolean {
    return this.#native.canGoBack();
  }

  /** Whether there is a next history entry to go forward to. */
  canGoForward(): boolean {
    return this.#native.canGoForward();
  }

  /** Evaluate JavaScript in the page (fire-and-forget, D022). */
  executeJavaScript(code: string): void {
    this.#native.executeJavaScript(code);
  }

  /** Open the developer tools (web inspector) for this view. Best-effort. */
  openDevTools(): void {
    this.#native.openDevTools();
  }

  /** Send an event on a channel to the renderer (`ipcRenderer.on` receives it). */
  send(channel: string, ...args: readonly unknown[]): void {
    this.#native.sendEnvelopeToRenderer(encodeEnvelope({ kind: 'send', channel, args }));
  }

  async #handleRendererEnvelope(json: string): Promise<void> {
    let envelope: ReturnType<typeof decodeEnvelope>;
    try {
      envelope = decodeEnvelope(json);
    } catch (error) {
      log.warn('dropping malformed renderer envelope', error);
      return;
    }
    if (envelope.kind !== 'send' && envelope.kind !== 'invoke') {
      return;
    }
    const reply = await ipcMain.dispatch(envelope, { sender: this });
    if (reply !== undefined) {
      this.#native.sendEnvelopeToRenderer(encodeEnvelope(reply));
    }
  }
}

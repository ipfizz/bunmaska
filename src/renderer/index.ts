import { createContextBridge } from './api/context-bridge';
import { createIpcRenderer } from './api/ipc-renderer';
import { createWebFrame } from './api/web-frame';

export { createIpcRenderer, type IpcRenderer, type IpcRendererEvent } from './api/ipc-renderer';
export { createContextBridge, type ContextBridge } from './api/context-bridge';
export {
  createWebFrame,
  type WebFrame,
  type WebFrameDocument,
  type WebFrameElement,
  type WebFrameScope,
} from './api/web-frame';
export { generatePreloadBootstrap } from './preload-bootstrap';

/** The `ipcRenderer` singleton. Drop-in equivalent of Electron's `ipcRenderer`. */
export const ipcRenderer = createIpcRenderer();

/** The `contextBridge` singleton. Drop-in equivalent of Electron's `contextBridge`. */
export const contextBridge = createContextBridge();

/** The `webFrame` singleton. Drop-in equivalent of Electron's `webFrame`. */
export const webFrame = createWebFrame();

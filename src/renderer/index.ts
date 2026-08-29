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

export const ipcRenderer = createIpcRenderer();

export const contextBridge = createContextBridge();

export const webFrame = createWebFrame();

# Bunmaska examples

Small, runnable apps demonstrating Bunmaska's API. Run any of them from the repo
root with `bun examples/<name>/main.ts`.

| Example | Shows |
| --- | --- |
| [hello-webview](./hello-webview) | The smallest real app: a window loading a URL. |
| [ipc-demo](./ipc-demo) | Secure IPC: an isolated `preload` exposes `window.api` over `contextBridge`, calling `ipcMain.handle`. |
| [window-controls](./window-controls) | `BrowserWindow` runtime setters: resizable, opacity, minimum size, center. |

These examples import Bunmaska via a relative path (`../../src/main`) because they
live inside the repo. In your own project you would `import { app, BrowserWindow }
from '@ipfizz/bunmaska'` instead — see `bunmaska init` for a scaffold.

> Note on preloads: a preload script is injected into the page's isolated world
> *verbatim*, so it must be plain JavaScript and uses the injected `contextBridge`
> and `__bunmaska` globals rather than `import`. See `ipc-demo/preload.js`.

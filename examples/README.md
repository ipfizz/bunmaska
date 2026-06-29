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
from 'bunmaska'` instead — see `bunmaska init` for a scaffold.

> Note on preloads: a preload script runs in the page's isolated world. It is
> bundled before injection, so you can `import` modules — just keep it browser code
> (no Node APIs) and use the injected `contextBridge` and `__bunmaska` globals. See
> `ipc-demo/preload.js`.

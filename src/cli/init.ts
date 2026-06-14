/**
 * `bunmaska init` — scaffold a new Bunmaska project from an embedded template.
 *
 * The template is a minimal but real app: a `BrowserWindow` that loads a local
 * page, an isolated `preload` exposing a typed `window.api` over IPC, a matching
 * `ipcMain.handle`, and a `bunmaska.config.ts`. The file contents are produced
 * purely (so they are unit-testable), and the disk writes go through injectable
 * seams that refuse to overwrite an existing file.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { slugifyName } from '../common/manifest';
import { BUNMASKA_VERSION } from '../common/version';

/** A single file the scaffold writes, addressed relative to the project root. */
export type ScaffoldFile = { readonly path: string; readonly contents: string };

/** Substituted values the template needs. */
export type TemplateVars = { readonly name: string; readonly id: string };

const packageJson = (vars: TemplateVars): string =>
  `${JSON.stringify(
    {
      name: slugifyName(vars.name),
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        start: 'bunmaska run src/main.ts',
        dev: 'bunmaska dev',
        build: 'bunmaska build',
      },
      dependencies: {
        '@ipfizz/bunmaska': `^${BUNMASKA_VERSION}`,
      },
    },
    null,
    2,
  )}\n`;

const configTs = (vars: TemplateVars): string =>
  `import { defineConfig } from '@ipfizz/bunmaska/config';

export default defineConfig({
  name: ${JSON.stringify(vars.name)},
  id: ${JSON.stringify(vars.id)},
  entry: 'src/main.ts',
});
`;

const mainTs = (vars: TemplateVars): string =>
  `import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from '@ipfizz/bunmaska';

// A demo handler the preload exposes to the page as window.api.ping().
ipcMain.handle('ping', () => 'pong');

const createWindow = (): void => {
  const win = new BrowserWindow({
    width: 900,
    height: 680,
    title: ${JSON.stringify(vars.name)},
    webPreferences: {
      preload: join(import.meta.dir, 'preload.js'),
    },
  });
  win.loadFile(join(import.meta.dir, 'index.html'));
};

app.whenReady().then(createWindow);

// On macOS apps usually stay alive until Cmd-Q; elsewhere, quit on last window.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
`;

const preloadJs = (): string =>
  `// Runs in Bunmaska's isolated preload world (Electron contextIsolation). It is
// injected verbatim — keep it plain JS. Two globals are available here:
//   contextBridge.exposeInMainWorld(key, api)  — expose a safe surface to the page
//   __bunmaska.invoke(channel, ...args)          — call an ipcMain.handle handler
// The page can then call window.api.ping(); it cannot reach Node or the bridge.
contextBridge.exposeInMainWorld('api', {
  ping: () => __bunmaska.invoke('ping'),
});
`;

const indexHtml = (vars: TemplateVars): string =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${vars.name}</title>
    <style>
      body {
        font-family: system-ui, sans-serif;
        display: grid;
        place-items: center;
        height: 100vh;
        margin: 0;
        background: #0b0b0f;
        color: #f4f4f5;
      }
      button {
        font: inherit;
        padding: 0.6rem 1.2rem;
        border-radius: 8px;
        border: 1px solid #3f3f46;
        background: #18181b;
        color: inherit;
        cursor: pointer;
      }
      #out {
        margin-top: 1rem;
        opacity: 0.7;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${vars.name}</h1>
      <button id="ping">Ping the main process</button>
      <p id="out"></p>
    </main>
    <script>
      const out = document.getElementById('out');
      document.getElementById('ping').addEventListener('click', async () => {
        const reply = await window.api.ping();
        out.textContent = 'main replied: ' + reply;
      });
    </script>
  </body>
</html>
`;

const gitignore = (): string =>
  `node_modules/
dist/
*.app/
*.dmg
*.tar.gz
*.tar.zst
*.deb
*.log
`;

const readme = (vars: TemplateVars): string =>
  `# ${vars.name}

A desktop app built with [Bunmaska](https://github.com/ipfizz/bunmaska) — a
drop-in Electron replacement on Bun + system WebKit.

## Develop

\`\`\`sh
bun install
bun run dev      # bunmaska dev: runs src/main.ts and reloads on change
\`\`\`

## Build a distributable

\`\`\`sh
bun run build    # bunmaska build: a macOS .app or a Linux AppDir/.deb
\`\`\`

The app's name, bundle id and entry are declared in \`bunmaska.config.ts\`.
`;

/** Produce the full set of template files with `vars` substituted. Pure. */
export const initTemplateFiles = (vars: TemplateVars): readonly ScaffoldFile[] => [
  { path: 'package.json', contents: packageJson(vars) },
  { path: 'bunmaska.config.ts', contents: configTs(vars) },
  { path: 'src/main.ts', contents: mainTs(vars) },
  { path: 'src/preload.js', contents: preloadJs() },
  { path: 'src/index.html', contents: indexHtml(vars) },
  { path: '.gitignore', contents: gitignore() },
  { path: 'README.md', contents: readme(vars) },
];

/** Injectable filesystem seams so scaffolding is unit-testable without real I/O. */
export type ScaffoldDeps = {
  readonly exists: (path: string) => boolean;
  readonly mkdir: (path: string) => void;
  readonly writeFile: (path: string, contents: string) => void;
};

const defaultDeps: ScaffoldDeps = {
  exists: existsSync,
  mkdir: (path) => {
    mkdirSync(path, { recursive: true });
  },
  writeFile: (path, contents) => {
    writeFileSync(path, contents);
  },
};

/**
 * Write `files` under `dir`, refusing to clobber: if ANY target already exists,
 * nothing is written and an error naming the file is thrown. Returns the
 * absolute paths written, in order.
 */
export const scaffoldProject = (
  dir: string,
  files: readonly ScaffoldFile[],
  deps: ScaffoldDeps = defaultDeps,
): string[] => {
  const root = resolve(dir);
  for (const file of files) {
    const full = join(root, file.path);
    if (deps.exists(full)) {
      throw new Error(`bunmaska init: refusing to overwrite existing file ${full}`);
    }
  }
  const written: string[] = [];
  for (const file of files) {
    const full = join(root, file.path);
    deps.mkdir(dirname(full));
    deps.writeFile(full, file.contents);
    written.push(full);
  }
  return written;
};

/** Derive a project name from a target directory's base name. */
export const deriveProjectName = (dir: string): string => {
  const base = basename(resolve(dir));
  return base.length > 0 && base !== '.' ? base : 'bunmaska-app';
};

/** The result of a successful {@link runInit}. */
export type InitResult = {
  readonly dir: string;
  readonly name: string;
  readonly written: readonly string[];
};

/**
 * Scaffold a project at `targetDir`. Derives the app name from the directory,
 * the bundle id as `com.example.<slug>`, writes the template, and returns what
 * was created. Throws if any target file already exists.
 */
export const runInit = (targetDir: string, deps: ScaffoldDeps = defaultDeps): InitResult => {
  const dir = resolve(targetDir);
  const name = deriveProjectName(dir);
  const id = `com.example.${slugifyName(name)}`;
  const files = initTemplateFiles({ name, id });
  const written = scaffoldProject(dir, files, deps);
  return { dir, name, written };
};

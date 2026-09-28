import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { slugifyName } from '../common/manifest';
import { BUNMASKA_VERSION } from '../common/version';

/** A scaffold file; `path` is relative to the project root. */
export type ScaffoldFile = { readonly path: string; readonly contents: string };

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
        build: 'bunmaska build --out dist',
      },
      dependencies: {
        bunmaska: `^${BUNMASKA_VERSION}`,
      },
      devDependencies: {
        '@types/bun': 'latest',
      },
    },
    null,
    2,
  )}\n`;

const tsconfigJson = (): string =>
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ESNext',
        module: 'Preserve',
        moduleResolution: 'bundler',
        lib: ['ESNext', 'DOM'],
        types: ['bun'],
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ['src', 'bunmaska.config.ts'],
    },
    null,
    2,
  )}\n`;

const configTs = (vars: TemplateVars): string =>
  `import { defineConfig } from 'bunmaska/config';

export default defineConfig({
  name: ${JSON.stringify(vars.name)},
  id: ${JSON.stringify(vars.id)},
  entry: 'src/main.ts',
  // renderer: { entry: 'src/renderer/main.tsx' }, // bunmaska.org/docs/building
});
`;

const mainTs = (vars: TemplateVars): string =>
  `import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'bunmaska';

ipcMain.handle('ping', () => 'pong');

// Under \`bunmaska dev\` the assets sit next to this file; a built app ships them
// beside the executable.
const assetDir = existsSync(join(import.meta.dir, 'index.html'))
  ? import.meta.dir
  : dirname(process.execPath);

const createWindow = (): void => {
  const win = new BrowserWindow({
    width: 900,
    height: 680,
    title: ${JSON.stringify(vars.name)},
    webPreferences: {
      preload: join(assetDir, 'preload.js'),
    },
  });
  win.loadFile(join(assetDir, 'index.html'));
};

app.whenReady().then(createWindow);

// On macOS apps usually stay alive until Cmd-Q and reopen a window from the Dock.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
app.on('activate', (_event, hasVisibleWindows) => {
  if (!hasVisibleWindows) {
    createWindow();
  }
});
`;

const preloadJs = (): string =>
  `// Isolated preload world, browser code only: bunmaska.org/docs/concepts/ipc
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
    <title>${Bun.escapeHTML(vars.name)}</title>
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
      <h1>${Bun.escapeHTML(vars.name)}</h1>
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
.bunmaska-dev-state.json
`;

const readme = (vars: TemplateVars): string =>
  `# ${vars.name}

A desktop app built with [Bunmaska](https://github.com/ipfizz/bunmaska) - a
drop-in Electron replacement on Bun + system WebKit.

## Develop

\`\`\`sh
bun install
bun run dev      # bunmaska dev: runs src/main.ts and reloads on change
\`\`\`

## Build a distributable

\`\`\`sh
bun run build    # into dist/: a .app (macOS), AppDir + .deb (Linux) or .zip (Windows)
\`\`\`

The app's name, bundle id and entry are declared in \`bunmaska.config.ts\`.
`;

export const initTemplateFiles = (vars: TemplateVars): readonly ScaffoldFile[] => [
  { path: 'package.json', contents: packageJson(vars) },
  { path: 'tsconfig.json', contents: tsconfigJson() },
  { path: 'bunmaska.config.ts', contents: configTs(vars) },
  { path: 'src/main.ts', contents: mainTs(vars) },
  { path: 'src/preload.js', contents: preloadJs() },
  { path: 'src/index.html', contents: indexHtml(vars) },
  { path: '.gitignore', contents: gitignore() },
  { path: 'README.md', contents: readme(vars) },
];

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

/** All-or-nothing: throws before writing if any target exists; returns the paths written. */
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

/** The directory's base name, or `bunmaska-app` at the filesystem root. */
export const deriveProjectName = (dir: string): string => basename(resolve(dir)) || 'bunmaska-app';

export type InitResult = {
  readonly dir: string;
  readonly name: string;
  readonly written: readonly string[];
};

/** Scaffolds a project with bundle id `com.example.<slug>`; throws if any target exists. */
export const runInit = (
  targetDir: string,
  deps: ScaffoldDeps = defaultDeps,
  explicitName?: string,
): InitResult => {
  const dir = resolve(targetDir);
  const name = explicitName?.trim() || deriveProjectName(dir);
  const id = `com.example.${slugifyName(name)}`;
  const files = initTemplateFiles({ name, id });
  const written = scaffoldProject(dir, files, deps);
  return { dir, name, written };
};

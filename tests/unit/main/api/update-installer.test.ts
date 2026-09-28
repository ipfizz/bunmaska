import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UpdateManifest } from '../../../../src/common/manifest';
import type { StagedUpdate } from '../../../../src/main/api/auto-updater';
import {
  buildCmdInstallScript,
  buildShInstallScript,
  deriveInstallRoot,
  installStagedUpdate,
  type InstallerDeps,
  shQuote,
  spawnDetachedScript,
  stagedBundleDirName,
} from '../../../../src/main/api/update-installer';

const manifest = (name: string): UpdateManifest => ({
  name,
  version: '2.0.0',
  channel: 'stable',
  os: 'macos',
  arch: 'arm64',
  hash: 'abc123',
  size: 8,
  artifact: 'my-app-stable-macos-arm64.tar.zst',
});

const staged = (name = 'My App'): StagedUpdate => ({
  manifest: manifest(name),
  tarPath: '/tmp/bunmaska-update-abc123.tar',
});

describe('deriveInstallRoot', () => {
  test('macOS: the .app bundle root is three levels above the executable', () => {
    expect(deriveInstallRoot('/Applications/My App.app/Contents/MacOS/My App', 'macos')).toBe(
      '/Applications/My App.app',
    );
  });

  test('macOS: refuses an un-bundled executable (bun run layout)', () => {
    expect(deriveInstallRoot('/opt/homebrew/bin/bun', 'macos')).toBeUndefined();
  });

  test('macOS: refuses when the directory names are not Contents/MacOS', () => {
    expect(deriveInstallRoot('/tmp/Demo.app/Contents/Resources/Demo', 'macos')).toBeUndefined();
    expect(deriveInstallRoot('/tmp/Demo.app/Wrong/MacOS/Demo', 'macos')).toBeUndefined();
  });

  test('macOS: refuses when the bundle root does not end in .app', () => {
    expect(deriveInstallRoot('/tmp/NotABundle/Contents/MacOS/Demo', 'macos')).toBeUndefined();
  });

  test('Linux: the AppDir root is three levels above the usr/bin executable', () => {
    expect(deriveInstallRoot('/opt/demo/usr/bin/demo', 'linux')).toBe('/opt/demo');
  });

  test('Linux: refuses a system binary whose AppDir would be the filesystem root', () => {
    expect(deriveInstallRoot('/usr/bin/demo', 'linux')).toBeUndefined();
  });

  test('Linux: refuses when the directory names are not usr/bin', () => {
    expect(deriveInstallRoot('/opt/demo/bin/demo', 'linux')).toBeUndefined();
    expect(deriveInstallRoot('/opt/demo/usr/sbin/demo', 'linux')).toBeUndefined();
  });

  test('Windows: the portable dir is the executable directory, never a root', () => {
    expect(deriveInstallRoot('/apps/Demo/Demo.exe', 'windows')).toBe('/apps/Demo');
    expect(deriveInstallRoot('/apps/Demo/demo.EXE', 'windows')).toBe('/apps/Demo');
    expect(deriveInstallRoot('/Demo.exe', 'windows')).toBeUndefined();
  });

  test('Windows: refuses a dev runner or any dir not laid out as <Name>/<Name>.exe', () => {
    expect(deriveInstallRoot('C:/Users/u/.bun/bin/bun.exe', 'windows')).toBeUndefined();
    expect(deriveInstallRoot('C:/tools/bun/bun.exe', 'windows')).toBeUndefined();
    expect(deriveInstallRoot('C:/tools/node/node.exe', 'windows')).toBeUndefined();
    expect(deriveInstallRoot('C:/Users/u/Downloads/Demo.exe', 'windows')).toBeUndefined();
  });
});

describe('stagedBundleDirName', () => {
  test('mirrors the bundle names bunmaska build tars up', () => {
    expect(stagedBundleDirName('My App', 'macos')).toBe('My App.app');
    expect(stagedBundleDirName('My App', 'linux')).toBe('My App');
    expect(stagedBundleDirName('My App', 'windows')).toBe('My App');
  });
});

describe('shQuote', () => {
  test('quotes spaces and embedded single quotes safely', () => {
    expect(shQuote('plain')).toBe("'plain'");
    expect(shQuote('with space')).toBe("'with space'");
    expect(shQuote("it's a trap")).toBe("'it'\\''s a trap'");
  });
});

/** Polls for a file a backgrounded helper writes; throws after 3s. */
const waitForFile = async (path: string): Promise<void> => {
  const deadline = Date.now() + 3000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) {
      throw new Error(`${path} never appeared`);
    }
    await Bun.sleep(20);
  }
};

/** Runs the real sh helper against a temp install root holding `v` = "old". */
const runShHelper = async (
  tarContents: 'new-bundle' | 'missing-tar',
): Promise<{ root: string; relaunched: string; cleanup: () => void }> => {
  const dir = mkdtempSync(join(tmpdir(), 'bunmaska-helper-'));
  const root = join(dir, 'Demo');
  mkdirSync(root);
  writeFileSync(join(root, 'v'), 'old');
  const tarPath = join(dir, 'up.tar');
  if (tarContents === 'new-bundle') {
    mkdirSync(join(dir, 'src', 'Demo'), { recursive: true });
    writeFileSync(join(dir, 'src', 'Demo', 'v'), 'new');
    Bun.spawnSync(['tar', '-cf', tarPath, '-C', join(dir, 'src'), 'Demo']);
  }
  const exited = Bun.spawn(['true']);
  await exited.exited;
  const relaunched = join(dir, 'relaunched');
  const scriptPath = join(dir, 'install.sh');
  writeFileSync(
    scriptPath,
    buildShInstallScript({
      pid: exited.pid,
      tarPath,
      installRoot: root,
      bundleDirName: 'Demo',
      relaunchArgv: ['touch', relaunched],
    }),
  );
  Bun.spawnSync(['/bin/sh', scriptPath]);
  return { root, relaunched, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

describe('buildShInstallScript', () => {
  test.skipIf(process.platform === 'win32')(
    'swaps the extracted bundle into place and relaunches it',
    async () => {
      const run = await runShHelper('new-bundle');
      try {
        await waitForFile(run.relaunched);
        expect(readFileSync(join(run.root, 'v'), 'utf8')).toBe('new');
        expect(existsSync(`${run.root}.update-old`)).toBe(false);
        expect(existsSync(`${run.root}.update-staging`)).toBe(false);
      } finally {
        run.cleanup();
      }
    },
  );

  test.skipIf(process.platform === 'win32')(
    'a failed extract leaves the installed app untouched and still relaunches it',
    async () => {
      const run = await runShHelper('missing-tar');
      try {
        await waitForFile(run.relaunched);
        expect(readFileSync(join(run.root, 'v'), 'utf8')).toBe('old');
        expect(existsSync(`${run.root}.update-staging`)).toBe(false);
      } finally {
        run.cleanup();
      }
    },
  );

  test('Linux relaunch execs the AppDir binary instead of open', () => {
    const script = buildShInstallScript({
      pid: 7,
      tarPath: '/tmp/up.tar',
      installRoot: '/opt/demo',
      bundleDirName: 'demo',
      relaunchArgv: ['/opt/demo/usr/bin/demo'],
    });
    expect(script).toContain("'/opt/demo/usr/bin/demo' &");
    expect(script).not.toContain("'open'");
  });
});

describe('buildCmdInstallScript', () => {
  test('generates the wait-swap-start cmd script whose every failure relaunches the app', () => {
    const script = buildCmdInstallScript({
      pid: 7,
      tarPath: 'C:\\tmp\\up.tar',
      installRoot: 'C:\\Apps\\Demo',
      bundleDirName: 'Demo',
      exeName: 'Demo.exe',
    });
    expect(script).toBe(
      [
        '@echo off',
        'rem bunmaska auto-update helper: waits for the app to exit, swaps, relaunches.',
        ':wait',
        'tasklist /FI "PID eq 7" | find "7" >nul',
        'if not errorlevel 1 (timeout /t 1 /nobreak >nul & goto wait)',
        'if exist "C:\\Apps\\Demo.update-old" rmdir /s /q "C:\\Apps\\Demo.update-old"',
        'if exist "C:\\Apps\\Demo.update-staging" rmdir /s /q "C:\\Apps\\Demo.update-staging"',
        'mkdir "C:\\Apps\\Demo.update-staging" || goto fail',
        'rem extract from cwd, not tar -C: Windows bsdtar mangles backslash -C paths',
        'cd /d "C:\\Apps\\Demo.update-staging" || goto fail',
        'tar -xf "C:\\tmp\\up.tar" || goto fail',
        'cd /d "%TEMP%"',
        'if not exist "C:\\Apps\\Demo.update-staging\\Demo" goto fail',
        'move "C:\\Apps\\Demo" "C:\\Apps\\Demo.update-old" || goto fail',
        'move "C:\\Apps\\Demo.update-staging\\Demo" "C:\\Apps\\Demo" || (move "C:\\Apps\\Demo.update-old" "C:\\Apps\\Demo" & goto fail)',
        'rmdir /s /q "C:\\Apps\\Demo.update-old"',
        'rmdir /s /q "C:\\Apps\\Demo.update-staging"',
        'del /q "C:\\tmp\\up.tar"',
        'start "" "C:\\Apps\\Demo\\Demo.exe"',
        '(goto) 2>nul & del "%~f0"',
        ':fail',
        'cd /d "%TEMP%"',
        'if exist "C:\\Apps\\Demo.update-staging" rmdir /s /q "C:\\Apps\\Demo.update-staging"',
        'start "" "C:\\Apps\\Demo\\Demo.exe"',
        'exit /b 1',
        '',
      ].join('\r\n'),
    );
  });
});

type Harness = {
  deps: InstallerDeps;
  scripts: Array<{ path: string; text: string }>;
  spawns: string[][];
  quits: number[];
};

const makeDeps = (execPath: string, os: 'macos' | 'linux' | 'windows'): Harness => {
  const scripts: Array<{ path: string; text: string }> = [];
  const spawns: string[][] = [];
  const quits: number[] = [];
  const deps: InstallerDeps = {
    execPath: () => execPath,
    os: () => os,
    pid: () => 4242,
    writeScript: (path, text) => scripts.push({ path, text }),
    spawnDetached: (argv) => spawns.push([...argv]),
    quit: () => quits.push(1),
  };
  return { deps, scripts, spawns, quits };
};

describe('installStagedUpdate', () => {
  test('refuses an executable that is not an installed bundle by throwing, leaving the app running', () => {
    const h = makeDeps('/opt/homebrew/bin/bun', 'macos');
    expect(() => installStagedUpdate(staged(), h.deps)).toThrow(/not an installed macos bundle/);
    expect(h.scripts).toHaveLength(0);
    expect(h.spawns).toHaveLength(0);
    expect(h.quits).toHaveLength(0);
  });

  test('macOS: writes the sh helper, spawns it detached via /bin/sh, then quits', () => {
    const h = makeDeps('/Applications/My App.app/Contents/MacOS/My App', 'macos');
    installStagedUpdate(staged(), h.deps);
    expect(h.scripts).toHaveLength(1);
    const script = h.scripts[0];
    expect(script?.path.endsWith('.sh')).toBe(true);
    expect(script?.text).toContain("'open' '/Applications/My App.app' &");
    expect(script?.text).toContain("mv '/Applications/My App.app'");
    expect(h.spawns).toEqual([['/bin/sh', script?.path ?? '']]);
    expect(h.quits).toHaveLength(1);
  });

  test('Linux: the helper relaunches the AppDir binary', () => {
    const h = makeDeps('/opt/My App/usr/bin/my-app', 'linux');
    installStagedUpdate(staged(), h.deps);
    expect(h.scripts[0]?.text).toContain("'/opt/My App/usr/bin/my-app' &");
    expect(h.spawns[0]?.[0]).toBe('/bin/sh');
  });

  test('Windows: spawns the cmd helper through cmd.exe /c', () => {
    const h = makeDeps('/apps/My App/My App.exe', 'windows');
    installStagedUpdate(staged(), h.deps);
    const script = h.scripts[0];
    expect(script?.path.endsWith('.cmd')).toBe(true);
    expect(h.spawns).toEqual([['cmd.exe', '/c', script?.path ?? '']]);
    expect(h.quits).toHaveLength(1);
  });
});

const pgidOf = (pid: number | string): string =>
  Bun.spawnSync(['ps', '-o', 'pgid=', '-p', String(pid)])
    .stdout.toString()
    .trim();

describe('spawnDetachedScript', () => {
  test.skipIf(process.platform === 'win32')(
    'starts the helper in its own session so it outlives the quitting app',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'bunmaska-detach-'));
      try {
        const out = join(dir, 'pgid');
        spawnDetachedScript([
          '/bin/sh',
          '-c',
          `ps -o pgid= -p $$ > ${shQuote(`${out}.tmp`)}; mv ${shQuote(`${out}.tmp`)} ${shQuote(out)}`,
        ]);
        await waitForFile(out);
        expect(readFileSync(out, 'utf8').trim()).not.toBe(pgidOf(process.pid));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

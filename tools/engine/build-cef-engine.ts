/**
 * Build a store-shaped Blink engine (lib/ + engine.json) from an official CEF
 * "minimal" distribution, verified against the SHA-1 in the CEF build index:
 *
 *   bun tools/engine/build-cef-engine.ts <outDir> [cefVersion]
 *
 * then `bunmaska engine install <outDir>/<id>`. macOS only so far; the helper
 * is compiled with the host clang.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEngineId } from '../../src/common/engine-id';
import { currentArch, currentPlatform } from '../../src/common/platform';
import { CEF_API_VERSION } from '../../src/main/platform/cef/cef-ffi';

const INDEX_URL = 'https://cef-builds.spotifycdn.com/index.json';
const HELPER_VARIANTS = ['', ' (Renderer)', ' (GPU)', ' (Plugin)', ' (Alerts)'] as const;

export type CefBuild = {
  readonly cefVersion: string;
  readonly chromiumVersion: string;
  readonly file: string;
  readonly sha1: string;
};

type IndexFile = { type?: unknown; name?: unknown; sha1?: unknown };
type IndexVersion = {
  cef_version?: unknown;
  chromium_version?: unknown;
  channel?: unknown;
  files?: IndexFile[];
};

/** The newest stable minimal build for `platformKey`, or the one whose CEF version starts with `wanted`. */
export const pickCefBuild = (index: unknown, platformKey: string, wanted?: string): CefBuild => {
  const versions = ((index as Record<string, { versions?: IndexVersion[] } | undefined>)[
    platformKey
  ]?.versions ?? []) as IndexVersion[];
  for (const v of versions) {
    const cef = String(v.cef_version ?? '');
    const matches = wanted === undefined ? v.channel === 'stable' : cef.startsWith(`${wanted}+`);
    const minimal = v.files?.find((f) => f.type === 'minimal');
    if (matches && minimal !== undefined) {
      return {
        cefVersion: cef,
        chromiumVersion: String(v.chromium_version ?? ''),
        file: String(minimal.name),
        sha1: String(minimal.sha1),
      };
    }
  }
  throw new Error(`no CEF minimal build for ${platformKey}${wanted ? ` ${wanted}` : ''}`);
};

/** `154.0.28+g564dd6c+chromium-154.0.8037.58` -> `cef-154.0.28-154.0.8037.58-bunmaska1-macos-arm64`. */
export const cefEngineId = (
  build: CefBuild,
  os: 'macos' | 'linux' | 'windows',
  arch: 'x64' | 'arm64',
): string => {
  const id = `cef-${build.cefVersion.split('+')[0]}-${build.chromiumVersion}-bunmaska1-${os}-${arch}`;
  parseEngineId(id);
  return id;
};

const run = (cmd: string[]): void => {
  const proc = Bun.spawnSync(cmd, { stdout: 'inherit', stderr: 'inherit' });
  if (proc.exitCode !== 0) {
    throw new Error(`${cmd[0]} exited ${proc.exitCode}`);
  }
};

const helperPlist = (name: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>${name}</string>
<key>CFBundleIdentifier</key><string>org.bunmaska.engine.helper</string>
<key>CFBundleName</key><string>${name}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><string>1</string>
</dict></plist>
`;

const main = async (): Promise<void> => {
  const [outDir, wanted] = process.argv.slice(2);
  if (outDir === undefined) {
    process.stderr.write('usage: bun tools/engine/build-cef-engine.ts <outDir> [cefVersion]\n');
    process.exit(2);
  }
  if (currentPlatform() !== 'macos') {
    throw new Error('build-cef-engine: only macOS engines are wired so far');
  }
  const arch = currentArch();
  const index: unknown = await (await fetch(INDEX_URL)).json();
  const build = pickCefBuild(index, arch === 'arm64' ? 'macosarm64' : 'macosx64', wanted);
  const id = cefEngineId(build, 'macos', arch);
  const cache = join(outDir, '.cache');
  mkdirSync(cache, { recursive: true });

  const archive = join(cache, build.file);
  if (!existsSync(archive)) {
    process.stdout.write(`downloading ${build.file}\n`);
    const response = await fetch(
      `https://cef-builds.spotifycdn.com/${encodeURIComponent(build.file)}`,
    );
    if (!response.ok) {
      throw new Error(`download failed: HTTP ${response.status}`);
    }
    writeFileSync(archive, new Uint8Array(await response.arrayBuffer()));
  }
  const sha1 = createHash('sha1').update(readFileSync(archive)).digest('hex');
  if (sha1 !== build.sha1) {
    rmSync(archive);
    throw new Error(`sha1 mismatch for ${build.file}: got ${sha1}, index says ${build.sha1}`);
  }

  const extracted = join(cache, `extract-${build.cefVersion.split('+')[0]}`);
  rmSync(extracted, { recursive: true, force: true });
  mkdirSync(extracted, { recursive: true });
  run(['tar', '-xjf', archive, '-C', extracted, '--strip-components=1']);

  const engine = join(outDir, id);
  const lib = join(engine, 'lib');
  rmSync(engine, { recursive: true, force: true });
  mkdirSync(lib, { recursive: true });
  run([
    'ditto',
    join(extracted, 'Release', 'Chromium Embedded Framework.framework'),
    join(lib, 'Chromium Embedded Framework.framework'),
  ]);

  const helperBinary = join(cache, 'bunmaska-helper');
  run([
    'clang',
    '-std=c17',
    '-pedantic',
    '-O2',
    '-Wall',
    '-Wextra',
    '-Werror',
    `-DBM_CEF_API_VERSION=${CEF_API_VERSION}`,
    '-o',
    helperBinary,
    join(import.meta.dir, 'cef-helper.c'),
  ]);
  for (const variant of HELPER_VARIANTS) {
    const name = `bunmaska Helper${variant}`;
    const contents = join(lib, `${name}.app`, 'Contents');
    mkdirSync(join(contents, 'MacOS'), { recursive: true });
    cpSync(helperBinary, join(contents, 'MacOS', name));
    writeFileSync(join(contents, 'Info.plist'), helperPlist(name));
  }

  cpSync(join(extracted, 'LICENSE.txt'), join(engine, 'LICENSE.txt'));
  cpSync(join(extracted, 'CREDITS.html'), join(engine, 'CREDITS.html'));
  writeFileSync(
    join(engine, 'engine.json'),
    `${JSON.stringify(
      {
        id,
        soname: 'Chromium Embedded Framework.framework/Chromium Embedded Framework',
        cef: build.cefVersion,
        chromium: build.chromiumVersion,
        source: build.file,
        sha1: build.sha1,
      },
      null,
      2,
    )}\n`,
  );
  rmSync(extracted, { recursive: true, force: true });
  process.stdout.write(`built ${engine}\ninstall with: bunmaska engine install ${engine}\n`);
};

if (import.meta.main) {
  await main();
}

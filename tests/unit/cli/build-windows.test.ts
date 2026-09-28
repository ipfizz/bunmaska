import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  buildCompileArgs,
  type WindowsMetadata,
  windowsLayout,
  zipFileName,
} from '../../../src/cli/build-windows';

describe('windowsLayout', () => {
  const layout = windowsLayout(join('/tmp', 'out'), 'My App');

  test('roots the portable dir at <out>/<Name>', () => {
    expect(layout.appDir.endsWith(join('out', 'My App'))).toBe(true);
  });

  test('derives a slug from the name', () => {
    expect(layout.slug).toBe('my-app');
  });

  test('names the executable <Name>.exe (Windows convention, spaces allowed)', () => {
    expect(layout.exeName).toBe('My App.exe');
    expect(layout.exePath.endsWith(join('My App', 'My App.exe'))).toBe(true);
  });

  test('bakes engine.id beside the executable', () => {
    expect(layout.engineIdPath.endsWith(join('My App', 'engine.id'))).toBe(true);
  });
});

describe('zipFileName', () => {
  test('is <Name>-windows-x64.zip (mirrors the Linux tarball name)', () => {
    expect(zipFileName('My App')).toBe('My App-windows-x64.zip');
  });
});

describe('buildCompileArgs', () => {
  const meta: WindowsMetadata = {
    title: 'My App',
    publisher: 'Bunmaska',
    version: '0.1.0',
    description: 'My App built with Bunmaska',
    hideConsole: true,
  };
  const args = buildCompileArgs('entry.ts', join('out', 'My App.exe'), meta, 'windows');

  test('cross/native compiles to the Windows x64 target', () => {
    expect(args.slice(0, 4)).toEqual([
      'build',
      'entry.ts',
      '--compile',
      '--target=bun-windows-x64',
    ]);
  });

  test('passes --outfile immediately before the output path', () => {
    const i = args.indexOf('--outfile');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe(join('out', 'My App.exe'));
  });

  test('minifies whitespace and syntax but NOT identifiers (keeps Function.name and stacks intact)', () => {
    expect(args).toContain('--minify-whitespace');
    expect(args).toContain('--minify-syntax');
    expect(args).not.toContain('--minify');
    expect(args).not.toContain('--minify-identifiers');
  });

  test('embeds the PE version metadata', () => {
    expect(args).toContain('--windows-title');
    expect(args[args.indexOf('--windows-title') + 1]).toBe('My App');
    expect(args[args.indexOf('--windows-version') + 1]).toBe('0.1.0');
    expect(args[args.indexOf('--windows-publisher') + 1]).toBe('Bunmaska');
    expect(args[args.indexOf('--windows-description') + 1]).toBe('My App built with Bunmaska');
  });

  test('hides the console when asked, and not otherwise', () => {
    expect(args).toContain('--windows-hide-console');
    const noHide = buildCompileArgs(
      'entry.ts',
      'out.exe',
      { ...meta, hideConsole: false },
      'windows',
    );
    expect(noHide).not.toContain('--windows-hide-console');
  });

  test('passes --windows-icon only when an icon is given', () => {
    expect(args).not.toContain('--windows-icon');
    const withIcon = buildCompileArgs(
      'entry.ts',
      'out.exe',
      { ...meta, icon: 'app.ico' },
      'windows',
    );
    expect(withIcon[withIcon.indexOf('--windows-icon') + 1]).toBe('app.ico');
  });

  test('off a Windows host keeps only --windows-hide-console, the one flag Bun accepts there', () => {
    const cross = buildCompileArgs('entry.ts', 'out.exe', { ...meta, icon: 'app.ico' }, 'macos');
    expect(cross.filter((arg) => arg.startsWith('--windows-'))).toEqual(['--windows-hide-console']);
  });
});

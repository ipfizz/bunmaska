import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  buildCompileArgs,
  numericVersion,
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

describe('numericVersion', () => {
  test('strips a prerelease tag to the numeric core (the VERSIONINFO need)', () => {
    expect(numericVersion('0.1.0-alpha.2')).toBe('0.1.0');
  });

  test('passes a clean x.y.z through', () => {
    expect(numericVersion('1.2.3')).toBe('1.2.3');
  });

  test('zero-pads short versions to three segments', () => {
    expect(numericVersion('1.2')).toBe('1.2.0');
    expect(numericVersion('2')).toBe('2.0.0');
  });

  test('drops +build metadata and any 4th segment', () => {
    expect(numericVersion('1.0.0+build.5')).toBe('1.0.0');
    expect(numericVersion('3.4.5.6')).toBe('3.4.5');
  });

  test('substitutes zero for a non-numeric segment', () => {
    expect(numericVersion('x.y.z')).toBe('0.0.0');
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
  const args = buildCompileArgs('entry.ts', join('out', 'My App.exe'), meta);

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

  test('minifies the distribution binary', () => {
    expect(args).toContain('--minify');
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
    const noHide = buildCompileArgs('entry.ts', 'out.exe', { ...meta, hideConsole: false });
    expect(noHide).not.toContain('--windows-hide-console');
  });

  test('passes --windows-icon only when an icon is given', () => {
    expect(args).not.toContain('--windows-icon');
    const withIcon = buildCompileArgs('entry.ts', 'out.exe', { ...meta, icon: 'app.ico' });
    expect(withIcon[withIcon.indexOf('--windows-icon') + 1]).toBe('app.ico');
  });
});

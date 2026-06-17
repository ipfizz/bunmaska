import { describe, expect, test } from 'bun:test';
import {
  buildHdiutilArgs,
  buildIconutilArgs,
  buildSipsArgs,
  iconsetSpec,
} from '../../../src/cli/build-macos';

describe('iconsetSpec', () => {
  const spec = iconsetSpec();

  test('lists the ten standard iconset entries', () => {
    expect(spec).toHaveLength(10);
  });

  test('carries the canonical names and pixel sizes in order', () => {
    expect(spec).toEqual([
      { name: 'icon_16x16.png', size: 16 },
      { name: 'icon_16x16@2x.png', size: 32 },
      { name: 'icon_32x32.png', size: 32 },
      { name: 'icon_32x32@2x.png', size: 64 },
      { name: 'icon_128x128.png', size: 128 },
      { name: 'icon_128x128@2x.png', size: 256 },
      { name: 'icon_256x256.png', size: 256 },
      { name: 'icon_256x256@2x.png', size: 512 },
      { name: 'icon_512x512.png', size: 512 },
      { name: 'icon_512x512@2x.png', size: 1024 },
    ]);
  });

  test('every @2x entry is double its non-retina sibling', () => {
    const bySize = new Map(spec.map((e) => [e.name, e.size]));
    for (const base of ['16x16', '32x32', '128x128', '256x256', '512x512']) {
      const one = bySize.get(`icon_${base}.png`);
      const two = bySize.get(`icon_${base}@2x.png`);
      expect(one).toBeDefined();
      expect(two).toBe((one ?? 0) * 2);
    }
  });
});

describe('buildSipsArgs', () => {
  test('resizes a square to <size>x<size> from src into dest', () => {
    expect(buildSipsArgs(128, '/tmp/src.png', '/tmp/out/icon_128x128.png')).toEqual([
      '-z',
      '128',
      '128',
      '/tmp/src.png',
      '--out',
      '/tmp/out/icon_128x128.png',
    ]);
  });
});

describe('buildIconutilArgs', () => {
  test('converts an iconset directory into an .icns output', () => {
    expect(buildIconutilArgs('/tmp/My App.iconset', '/tmp/out/My App.icns')).toEqual([
      '-c',
      'icns',
      '/tmp/My App.iconset',
      '-o',
      '/tmp/out/My App.icns',
    ]);
  });
});

describe('buildHdiutilArgs', () => {
  const args = buildHdiutilArgs({
    volName: 'My App',
    srcFolder: '/tmp/stage',
    outDmg: '/tmp/out/My App.dmg',
  });

  test('builds a compressed UDZO create argv with the volume name and paths', () => {
    expect(args).toEqual([
      'create',
      '-volname',
      'My App',
      '-srcfolder',
      '/tmp/stage',
      '-ov',
      '-format',
      'UDZO',
      '/tmp/out/My App.dmg',
    ]);
  });

  test('overwrites an existing image with -ov', () => {
    expect(args).toContain('-ov');
  });

  test('targets the output dmg path as the final argument', () => {
    expect(args.at(-1)).toBe('/tmp/out/My App.dmg');
  });
});

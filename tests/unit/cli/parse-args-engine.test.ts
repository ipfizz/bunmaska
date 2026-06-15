import { describe, expect, test } from 'bun:test';
import { parseArgs } from '../../../src/cli/parse-args';

const ID = 'webkitgtk-6.0-2.52.4-bunmaska1-linux-x64';

describe('parseArgs — engine subcommands', () => {
  test('engine list', () => {
    expect(parseArgs(['engine', 'list'])).toEqual({ kind: 'engine', sub: { action: 'list' } });
  });

  test('engine which (no target)', () => {
    expect(parseArgs(['engine', 'which'])).toEqual({ kind: 'engine', sub: { action: 'which' } });
  });

  test('engine which <target>', () => {
    expect(parseArgs(['engine', 'which', '.'])).toEqual({
      kind: 'engine',
      sub: { action: 'which', target: '.' },
    });
  });

  test('engine install <source>', () => {
    expect(parseArgs(['engine', 'install', './my-engine'])).toEqual({
      kind: 'engine',
      sub: { action: 'install', source: './my-engine' },
    });
  });

  test('engine install requires a source', () => {
    expect(parseArgs(['engine', 'install'])).toMatchObject({ kind: 'error' });
  });

  test('engine use <id>', () => {
    expect(parseArgs(['engine', 'use', ID])).toEqual({
      kind: 'engine',
      sub: { action: 'use', id: ID },
    });
  });

  test('engine use <id> --for <dir>', () => {
    expect(parseArgs(['engine', 'use', ID, '--for', 'apps/demo'])).toEqual({
      kind: 'engine',
      sub: { action: 'use', id: ID, for: 'apps/demo' },
    });
  });

  test('engine use rejects a --global switch (anti-nvm guardrail)', () => {
    expect(parseArgs(['engine', 'use', ID, '--global'])).toMatchObject({ kind: 'error' });
  });

  test('engine prune and engine prune --dry-run', () => {
    expect(parseArgs(['engine', 'prune'])).toEqual({
      kind: 'engine',
      sub: { action: 'prune', dryRun: false },
    });
    expect(parseArgs(['engine', 'prune', '--dry-run'])).toEqual({
      kind: 'engine',
      sub: { action: 'prune', dryRun: true },
    });
  });

  test('engine verify <id>', () => {
    expect(parseArgs(['engine', 'verify', ID])).toEqual({
      kind: 'engine',
      sub: { action: 'verify', id: ID },
    });
  });

  test('engine with no subcommand is an error', () => {
    expect(parseArgs(['engine'])).toMatchObject({ kind: 'error' });
  });

  test('engine with an unknown subcommand is an error', () => {
    expect(parseArgs(['engine', 'frobnicate'])).toMatchObject({ kind: 'error' });
  });
});

describe('parseArgs — doctor', () => {
  test('doctor (no target)', () => {
    expect(parseArgs(['doctor'])).toEqual({ kind: 'doctor' });
  });

  test('doctor <target>', () => {
    expect(parseArgs(['doctor', '.'])).toEqual({ kind: 'doctor', target: '.' });
  });
});

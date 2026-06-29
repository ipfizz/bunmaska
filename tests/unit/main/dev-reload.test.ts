import { describe, expect, test } from 'bun:test';
import {
  DEV_RELOAD_COMMAND,
  type DevStdin,
  handleDevChunk,
  parseDevCommands,
  startDevReload,
} from '../../../src/main/dev-reload';

describe('parseDevCommands', () => {
  test('splits into trimmed, non-empty lines', () => {
    expect(parseDevCommands('reload\n')).toEqual(['reload']);
    expect(parseDevCommands('  reload  \n\n')).toEqual(['reload']);
    expect(parseDevCommands('reload\nreload\n')).toEqual(['reload', 'reload']);
    expect(parseDevCommands('')).toEqual([]);
  });
});

describe('handleDevChunk', () => {
  test('runs reloadAll once per reload command', () => {
    let count = 0;
    handleDevChunk('reload\nreload\n', () => {
      count += 1;
    });
    expect(count).toBe(2);
  });

  test('ignores unknown commands', () => {
    let count = 0;
    handleDevChunk('nope\n\n', () => {
      count += 1;
    });
    expect(count).toBe(0);
  });

  test('DEV_RELOAD_COMMAND is the trigger', () => {
    let count = 0;
    handleDevChunk(`${DEV_RELOAD_COMMAND}\n`, () => {
      count += 1;
    });
    expect(count).toBe(1);
  });
});

describe('startDevReload', () => {
  test('reloads when a reload chunk arrives on stdin, and unrefs the handle', () => {
    let listener: ((chunk: Buffer | string) => void) | undefined;
    let unrefed = false;
    let reloads = 0;
    const stdin: DevStdin = {
      on: (_event, cb) => {
        listener = cb;
      },
      unref: () => {
        unrefed = true;
      },
    };

    startDevReload(() => {
      reloads += 1;
    }, stdin);

    expect(unrefed).toBe(true);
    listener?.('reload\n');
    expect(reloads).toBe(1);
    // Buffers arrive too — they must be handled the same as strings.
    listener?.(Buffer.from('reload\n'));
    expect(reloads).toBe(2);
  });
});

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
  const fakeStdin = () => {
    const listeners = new Map<string, (chunk?: Buffer | string) => void>();
    let unrefed = false;
    const stdin: DevStdin = {
      on: (event, cb) => {
        listeners.set(event, cb);
      },
      unref: () => {
        unrefed = true;
      },
    };
    return { stdin, listeners, unrefed: () => unrefed };
  };

  test('reloads when a reload chunk arrives on stdin, and unrefs the handle', () => {
    const fake = fakeStdin();
    let reloads = 0;
    startDevReload(
      () => {
        reloads += 1;
      },
      () => undefined,
      fake.stdin,
    );

    expect(fake.unrefed()).toBe(true);
    fake.listeners.get('data')?.('reload\n');
    expect(reloads).toBe(1);
    // Buffers arrive too; they must be handled the same as strings.
    fake.listeners.get('data')?.(Buffer.from('reload\n'));
    expect(reloads).toBe(2);
  });

  test('reports a closed stdin, so the app does not outlive a dead supervisor', () => {
    const fake = fakeStdin();
    let gone = 0;
    startDevReload(
      () => undefined,
      () => {
        gone += 1;
      },
      fake.stdin,
    );
    fake.listeners.get('end')?.();
    expect(gone).toBe(1);
  });
});

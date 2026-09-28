import { afterEach, describe, expect, test } from 'bun:test';
import {
  createLogger,
  type LogRecord,
  type LogSink,
  resetLogger,
  setLogLevel,
  setLogSink,
} from '../../../src/common/logger';

const collect = (): { sink: LogSink; records: LogRecord[] } => {
  const records: LogRecord[] = [];
  return { sink: (r) => records.push(r), records };
};

/** Run `fn` with process.stderr captured; returns what was written. */
const captureStderr = (fn: () => void): string => {
  const written: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return written.join('');
};

afterEach(() => {
  resetLogger();
});

describe('createLogger', () => {
  test('returns an object with error/warn/info/debug methods', () => {
    const log = createLogger('test');
    expect(typeof log.error).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.debug).toBe('function');
  });

  test('forwards the namespace on every record', () => {
    const { sink, records } = collect();
    setLogSink(sink);
    setLogLevel('debug');
    createLogger('ffi').info('hello');
    expect(records[0]?.namespace).toBe('ffi');
  });

  test('passes level, message, and optional detail through to the sink', () => {
    const { sink, records } = collect();
    setLogSink(sink);
    setLogLevel('debug');
    const detail = { code: 42 };
    createLogger('x').warn('careful', detail);
    expect(records[0]?.level).toBe('warn');
    expect(records[0]?.message).toBe('careful');
    expect(records[0]?.detail).toBe(detail);
  });
});

describe('level filtering', () => {
  test('default level suppresses info and debug but allows warn and error', () => {
    const { sink, records } = collect();
    setLogSink(sink);
    const log = createLogger('x');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(records.map((r) => r.level)).toEqual(['warn', 'error']);
  });

  test("setLogLevel('silent') suppresses everything", () => {
    const { sink, records } = collect();
    setLogSink(sink);
    setLogLevel('silent');
    const log = createLogger('x');
    log.error('e');
    log.warn('w');
    expect(records).toHaveLength(0);
  });

  test("setLogLevel('debug') allows everything", () => {
    const { sink, records } = collect();
    setLogSink(sink);
    setLogLevel('debug');
    const log = createLogger('x');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(records).toHaveLength(4);
  });
});

describe('default sink', () => {
  test('writes warn and error to stderr with the namespace, and drops info', () => {
    const out = captureStderr(() => {
      const log = createLogger('run-loop');
      log.info('quiet');
      log.warn('careful');
      log.error('drain tick threw', { code: 42 });
    });
    expect(out).toContain('[bunmaska:run-loop] warn: careful');
    expect(out).toContain('[bunmaska:run-loop] error: drain tick threw');
    expect(out).toContain('42');
    expect(out).not.toContain('quiet');
  });
});

describe('resetLogger', () => {
  test('restores the default level and the stderr sink', () => {
    const { sink, records } = collect();
    setLogSink(sink);
    setLogLevel('debug');
    resetLogger();
    const out = captureStderr(() => {
      createLogger('x').debug('below the default level');
      createLogger('x').error('back on stderr');
    });
    expect(records).toHaveLength(0);
    expect(out).toContain('back on stderr');
    expect(out).not.toContain('below the default level');
  });
});

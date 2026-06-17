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

describe('resetLogger', () => {
  test('restores the default level and a non-collecting sink', () => {
    const { sink, records } = collect();
    setLogSink(sink);
    setLogLevel('debug');
    resetLogger();
    createLogger('x').error('should not reach the old sink');
    expect(records).toHaveLength(0);
  });
});

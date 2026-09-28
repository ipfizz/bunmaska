/**
 * Minimal leveled diagnostics (Biome bans `console.*` in committed code). The
 * default sink writes to stderr at `warn` and above; tests swap it via {@link setLogSink}.
 */

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export type LogRecord = {
  readonly namespace: string;
  readonly level: Exclude<LogLevel, 'silent'>;
  readonly message: string;
  readonly detail?: unknown;
};

export type LogSink = (record: LogRecord) => void;

export type Logger = {
  readonly error: (message: string, detail?: unknown) => void;
  readonly warn: (message: string, detail?: unknown) => void;
  readonly info: (message: string, detail?: unknown) => void;
  readonly debug: (message: string, detail?: unknown) => void;
};

const RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const DEFAULT_LEVEL: LogLevel = 'warn';
const STDERR_SINK: LogSink = ({ namespace, level, message, detail }) => {
  const suffix = detail === undefined ? '' : ` ${Bun.inspect(detail)}`;
  process.stderr.write(`[bunmaska:${namespace}] ${level}: ${message}${suffix}\n`);
};

let currentLevel: LogLevel = DEFAULT_LEVEL;
let currentSink: LogSink = STDERR_SINK;

/** Set the global minimum level. Records below this level are dropped. */
export const setLogLevel = (level: LogLevel): void => {
  currentLevel = level;
};

/** Replace the global sink. Use a collecting sink in tests. */
export const setLogSink = (sink: LogSink): void => {
  currentSink = sink;
};

/** Restore the default level and stderr sink. Intended for test teardown. */
export const resetLogger = (): void => {
  currentLevel = DEFAULT_LEVEL;
  currentSink = STDERR_SINK;
};

const emit = (
  namespace: string,
  level: Exclude<LogLevel, 'silent'>,
  message: string,
  detail?: unknown,
): void => {
  if (RANK[level] > RANK[currentLevel]) {
    return;
  }
  currentSink(
    detail === undefined ? { namespace, level, message } : { namespace, level, message, detail },
  );
};

/** Create a logger bound to a namespace (typically a module name). */
export const createLogger = (namespace: string): Logger => ({
  error: (message, detail) => emit(namespace, 'error', message, detail),
  warn: (message, detail) => emit(namespace, 'warn', message, detail),
  info: (message, detail) => emit(namespace, 'info', message, detail),
  debug: (message, detail) => emit(namespace, 'debug', message, detail),
});

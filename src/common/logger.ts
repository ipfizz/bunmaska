/**
 * Minimal leveled diagnostics for Bunmaska.
 *
 * Exists because Biome bans `console.*` in committed code and the FFI layer
 * needs a place to report which library failed to load or which selector did
 * not resolve. The default sink is a no-op so a quiet library stays quiet;
 * apps or tests opt in via {@link setLogSink} / {@link setLogLevel}.
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
const NOOP_SINK: LogSink = () => undefined;

let currentLevel: LogLevel = DEFAULT_LEVEL;
let currentSink: LogSink = NOOP_SINK;

/** Set the global minimum level. Records below this level are dropped. */
export const setLogLevel = (level: LogLevel): void => {
  currentLevel = level;
};

/** Replace the global sink. Use a collecting sink in tests. */
export const setLogSink = (sink: LogSink): void => {
  currentSink = sink;
};

/** Restore the default level and no-op sink. Intended for test teardown. */
export const resetLogger = (): void => {
  currentLevel = DEFAULT_LEVEL;
  currentSink = NOOP_SINK;
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

import type { LogFields, LogLevel, Logger } from '../../../src/core/runtime/logger.js';

export interface LogEntry {
  level: LogLevel;
  msg: string;
  fields: LogFields | undefined;
}

/** Captures log calls in memory. `text()` is the JSON dump used by "never logged" assertions. */
export function createMemoryLogger(): Logger & { entries: LogEntry[]; text(): string } {
  const entries: LogEntry[] = [];
  const push = (level: LogLevel) => (msg: string, fields?: LogFields) => {
    entries.push({ level, msg, fields });
  };
  return {
    entries,
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    text: () => JSON.stringify(entries, (_k, v: unknown) => (v instanceof Error ? v.message : v)),
  };
}

import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

/** Structured logger. Implementations redact secrets; callers still never pass tokens or prompt text. */
export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const LOG_FILE = 'agent.log';
const DEFAULT_MAX_BYTES = 1_048_576;
const DEFAULT_FILES = 5;
const MAX_DEPTH = 8;
const RESERVED = new Set(['ts', 'level', 'msg']);

const REDACTED = '[redacted]';
const SECRET_KEY = /token|authorization|content|prompt|email/i;
const BEARER = /\b(bearer)\s+[^\s"'<>,;]+/gi;

function scrub(s: string): string {
  return s.replace(BEARER, `$1 ${REDACTED}`);
}

/**
 * Makes a value safe to log: redacts secret-looking keys at any depth, scrubs Bearer credentials
 * from strings, reduces errors to name + message, and cuts cycles and deep nesting.
 */
function sanitize(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrub(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: scrub(value.message) };
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (ancestors.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[truncated]';

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((v: unknown) => sanitize(v, depth + 1, ancestors) ?? null);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? REDACTED : sanitize(v, depth + 1, ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}

function fileSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/** Runs a filesystem step best-effort: a failing disk must never break the agent. */
function attempt(fn: () => void): void {
  try {
    fn();
  } catch {
    return;
  }
}

/** agent.log → agent.log.1 → … → agent.log.<files-1>; the oldest is deleted. */
function rotate(file: string, files: number): void {
  if (files <= 1) {
    attempt(() => rmSync(file, { force: true }));
    return;
  }
  attempt(() => rmSync(`${file}.${files - 1}`, { force: true }));
  for (let i = files - 2; i >= 1; i--) {
    const from = `${file}.${i}`;
    const to = `${file}.${i + 1}`;
    attempt(() => renameSync(from, to));
  }
  attempt(() => renameSync(file, `${file}.1`));
}

/**
 * JSON-lines file logger at `<dir>/agent.log` with size-based rotation (`files` files in total).
 * Keys matching /token|authorization|content|prompt|email/i are redacted at any depth and
 * `Bearer …` credentials are scrubbed from every string. Never throws.
 */
export function createLogger(o: {
  dir: string;
  level?: LogLevel;
  maxBytes?: number;
  files?: number;
  clock?: () => Date;
}): Logger {
  const file = path.join(o.dir, LOG_FILE);
  const min = LEVELS[o.level ?? 'info'];
  const maxBytes = o.maxBytes ?? DEFAULT_MAX_BYTES;
  const files = Math.max(1, Math.floor(o.files ?? DEFAULT_FILES));
  const clock = o.clock ?? ((): Date => new Date());

  attempt(() => mkdirSync(o.dir, { recursive: true }));

  const write = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (LEVELS[level] < min) return;
    attempt(() => {
      const entry: Record<string, unknown> = { ts: clock().toISOString(), level, msg: scrub(msg) };
      const safe = (fields === undefined ? {} : sanitize(fields, 0, new WeakSet())) as LogFields;
      for (const [k, v] of Object.entries(safe)) {
        if (!RESERVED.has(k)) entry[k] = v;
      }
      const line = `${JSON.stringify(entry)}\n`;
      const size = fileSize(file);
      if (size > 0 && size + Buffer.byteLength(line) > maxBytes) rotate(file, files);
      appendFileSync(file, line);
    });
  };

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}

import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../../src/core/runtime/logger.js';

let dir: string;
const fixedClock = (): Date => new Date('2026-09-24T01:02:03.456Z');

function lines(file = 'agent.log'): Record<string, unknown>[] {
  return readFileSync(path.join(dir, file), 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), '6am-logger-'));
});

afterEach(() => {
  if (existsSync(dir)) chmodSync(dir, 0o700);
  rmSync(dir, { recursive: true, force: true });
});

describe('createLogger', () => {
  it('writes JSON lines with ts, level, msg and fields to agent.log', () => {
    const log = createLogger({ dir, clock: fixedClock });
    log.info('sync done', { batches: 2, status: 'ok' });
    log.warn('slow');
    expect(lines()).toEqual([
      { ts: '2026-09-24T01:02:03.456Z', level: 'info', msg: 'sync done', batches: 2, status: 'ok' },
      { ts: '2026-09-24T01:02:03.456Z', level: 'warn', msg: 'slow' },
    ]);
  });

  it('creates the log directory recursively', () => {
    const nested = path.join(dir, 'a', 'b');
    createLogger({ dir: nested }).info('hello');
    expect(existsSync(path.join(nested, 'agent.log'))).toBe(true);
  });

  it('defaults to info level and drops debug', () => {
    const log = createLogger({ dir });
    log.debug('hidden');
    log.info('shown');
    log.error('also shown');
    expect(lines().map((l) => l.level)).toEqual(['info', 'error']);
  });

  it('filters by the configured level', () => {
    const warnOnly = createLogger({ dir, level: 'warn' });
    warnOnly.debug('a');
    warnOnly.info('b');
    warnOnly.warn('c');
    warnOnly.error('d');
    expect(lines().map((l) => l.msg)).toEqual(['c', 'd']);

    rmSync(path.join(dir, 'agent.log'));
    createLogger({ dir, level: 'debug' }).debug('e');
    expect(lines().map((l) => l.msg)).toEqual(['e']);
  });

  it('fields cannot override ts, level or msg', () => {
    createLogger({ dir, clock: fixedClock }).info('real', { ts: 'x', level: 'error', msg: 'fake' });
    const [line] = lines();
    expect(line).toMatchObject({ ts: '2026-09-24T01:02:03.456Z', level: 'info', msg: 'real' });
  });

  describe('redaction', () => {
    it('redacts token, authorization, content, prompt and email keys at any depth', () => {
      createLogger({ dir }).info('req', {
        token: 'secret-1',
        deviceToken: 'secret-2',
        request: {
          headers: { Authorization: 'Bearer abc', Accept: 'application/json' },
          body: { messages: [{ role: 'user', content: 'my prompt' }] },
        },
        list: [{ email: 'a@b.test' }, { promptText: 'x', keep: 1 }],
        EMAIL_ADDRESS: 'c@d.test',
        contentLength: 12,
        status: 200,
      });
      const [line] = lines();
      expect(line).toMatchObject({
        token: '[redacted]',
        deviceToken: '[redacted]',
        request: {
          headers: { Authorization: '[redacted]', Accept: 'application/json' },
          body: { messages: [{ role: 'user', content: '[redacted]' }] },
        },
        list: [{ email: '[redacted]' }, { promptText: '[redacted]', keep: 1 }],
        EMAIL_ADDRESS: '[redacted]',
        contentLength: '[redacted]',
        status: 200,
      });
      const raw = readFileSync(path.join(dir, 'agent.log'), 'utf8');
      for (const secret of ['secret-1', 'secret-2', 'abc', 'my prompt', 'a@b.test', 'c@d.test']) {
        expect(raw).not.toContain(secret);
      }
    });

    it('scrubs Bearer credentials inside any string, including msg', () => {
      createLogger({ dir }).warn('sent Bearer sk-live-123 to server', {
        note: 'header was "Bearer xyz.789" earlier',
        nested: ['bearer lowercase-456'],
      });
      const [line] = lines();
      expect(line?.msg).toBe('sent Bearer [redacted] to server');
      expect(line?.note).toBe('header was "Bearer [redacted]" earlier');
      expect(line?.nested).toEqual(['bearer [redacted]']);
      const raw = readFileSync(path.join(dir, 'agent.log'), 'utf8');
      expect(raw).not.toMatch(/sk-live-123|xyz\.789|lowercase-456/);
    });

    it('serializes errors as name and message without a stack', () => {
      const err = new TypeError('boom Bearer leaked-token');
      createLogger({ dir }).error('failed', { err, list: [new Error('inner')] });
      const [line] = lines();
      expect(line?.err).toEqual({ name: 'TypeError', message: 'boom Bearer [redacted]' });
      expect(line?.list).toEqual([{ name: 'Error', message: 'inner' }]);
      expect(readFileSync(path.join(dir, 'agent.log'), 'utf8')).not.toContain('at ');
    });

    it('is cycle-safe and depth-limited', () => {
      const cyclic: Record<string, unknown> = { name: 'root' };
      cyclic.self = cyclic;
      let deep: Record<string, unknown> = { leaf: true };
      for (let i = 0; i < 20; i++) deep = { next: deep };
      createLogger({ dir }).info('shapes', { cyclic, deep });
      const [line] = lines();
      expect(line?.cyclic).toEqual({ name: 'root', self: '[circular]' });
      expect(JSON.stringify(line?.deep)).toContain('[truncated]');
      expect(JSON.stringify(line?.deep)).not.toContain('leaf');
    });

    it('serializes non-JSON values safely', () => {
      createLogger({ dir }).info('values', {
        big: 10n,
        fn: () => 1,
        sym: Symbol('s'),
        undef: undefined,
        nil: null,
        date: new Date('2026-01-01T00:00:00Z'),
        badDate: new Date('not a date'),
        sparse: [1, undefined, () => 2],
      });
      const [line] = lines();
      expect(line).toMatchObject({
        big: '10',
        nil: null,
        date: '2026-01-01T00:00:00.000Z',
        badDate: null,
        sparse: [1, null, null],
      });
      expect(line?.fn).toBeUndefined();
      expect(line?.sym).toBeUndefined();
      expect('undef' in (line ?? {})).toBe(false);
    });
  });

  describe('rotation', () => {
    it('rotates before exceeding maxBytes and keeps exactly `files` files', () => {
      const log = createLogger({ dir, maxBytes: 200, files: 3 });
      for (let i = 0; i < 40; i++) log.info(`line-${i}`, { pad: 'x'.repeat(40) });
      const names = readdirSync(dir).sort();
      expect(names).toEqual(['agent.log', 'agent.log.1', 'agent.log.2']);
      for (const name of names) {
        expect(readFileSync(path.join(dir, name)).byteLength).toBeLessThanOrEqual(200);
      }
      const newest = lines().map((l) => l.msg);
      expect(newest.at(-1)).toBe('line-39');
      const previous = lines('agent.log.1').map((l) => l.msg);
      const prevLast = Number(String(previous.at(-1)).slice(5));
      const newestFirst = Number(String(newest[0]).slice(5));
      expect(newestFirst).toBe(prevLast + 1);
    });

    it('uses defaults of 1 MiB and 5 files', () => {
      const log = createLogger({ dir });
      const pad = 'y'.repeat(100_000);
      for (let i = 0; i < 70; i++) log.info('big', { pad });
      expect(readdirSync(dir).sort()).toEqual([
        'agent.log',
        'agent.log.1',
        'agent.log.2',
        'agent.log.3',
        'agent.log.4',
      ]);
      expect(readFileSync(path.join(dir, 'agent.log')).byteLength).toBeLessThanOrEqual(1_048_576);
    });

    it('with files = 1 truncates instead of keeping backups', () => {
      const log = createLogger({ dir, maxBytes: 100, files: 1 });
      for (let i = 0; i < 10; i++) log.info(`n${i}`, { pad: 'z'.repeat(30) });
      expect(readdirSync(dir)).toEqual(['agent.log']);
      expect(lines().at(-1)?.msg).toBe('n9');
    });

    it('writes a single oversized line into a fresh file', () => {
      const log = createLogger({ dir, maxBytes: 50, files: 2 });
      log.info('first');
      log.info('huge', { pad: 'q'.repeat(200) });
      expect(lines().map((l) => l.msg)).toEqual(['huge']);
      expect(lines('agent.log.1').map((l) => l.msg)).toEqual(['first']);
    });
  });

  it('never throws when the directory becomes unwritable or disappears', () => {
    const log = createLogger({ dir, maxBytes: 100 });
    log.info('ok');
    chmodSync(dir, 0o500);
    expect(() => {
      for (let i = 0; i < 5; i++) log.error('cannot write', { pad: 'x'.repeat(50) });
    }).not.toThrow();
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
    expect(() => log.warn('gone')).not.toThrow();
  });

  it('never throws when the directory cannot be created', () => {
    createLogger({ dir }).info('x');
    const underAFile = path.join(dir, 'agent.log', 'sub');
    expect(() => createLogger({ dir: underAFile }).info('y')).not.toThrow();
    expect(existsSync(underAFile)).toBe(false);
  });
});

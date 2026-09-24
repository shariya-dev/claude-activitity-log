import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClaudeScanner } from '../../../src/core/claude/scanner.js';
import { SYNC_LIMITS } from '../../../src/core/contract/index.js';
import {
  addTranscript,
  assertValidChunk,
  collect,
  commit,
  DEVICE_UID,
  makeClaudeDir,
  merged,
  scanOptions,
  settings,
  sid,
  type ClaudeDir,
} from './helpers.js';

const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const ts = (i: number) => new Date(Date.UTC(2026, 8, 22, 6, 0, 0) + i * 1000).toISOString();

function line(sessionId: string, i: number, over: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'attachment',
    sessionId,
    uuid: `u-${sessionId}-${i}`,
    timestamp: ts(i),
    version: '2.1.274',
    entrypoint: 'cli',
    gitBranch: 'main',
    ...over,
  });
}

function usageLine(sessionId: string, i: number, cwd: string) {
  return line(sessionId, i, {
    type: 'assistant',
    cwd,
    requestId: `req_${sessionId}_${i}`,
    message: {
      id: `msg_${sessionId}_${i}`,
      model: 'claude-opus-5',
      usage: { input_tokens: 1, output_tokens: 2 },
    },
  });
}

async function writeSession(dir: ClaudeDir, sessionId: string, lines: string[]) {
  const file = path.join(dir.projectDir, `${sessionId}.jsonl`);
  await writeFile(file, lines.join('\n') + '\n');
  return file;
}

const scanner = (dir: ClaudeDir) =>
  createClaudeScanner({
    source: dir.source,
    deviceUid: () => DEVICE_UID,
    readGitRemote: async () => null,
  });

describe('scanner — chunk limits with launch projects', () => {
  it('never exceeds the project limit when a launch cwd follows a cwd-less first line', async () => {
    const dir = await makeClaudeDir();
    await writeSession(
      dir,
      'a-session',
      Array.from({ length: SYNC_LIMITS.projects }, (_, i) =>
        line('a-session', i, { cwd: `/p/${i}` }),
      ),
    );
    await writeSession(dir, 'b-session', [
      line('b-session', 500, { type: 'queue-operation' }),
      line('b-session', 501, { type: 'user', cwd: '/q', message: { content: 'x' } }),
    ]);
    const chunks = await collect(scanner(dir));
    chunks.forEach(assertValidChunk);
    expect(chunks.length).toBeGreaterThan(1);
    // Latest non-null wins on the backend: the chunk that carries the launch line has the key.
    const b = merged(chunks).sessions.filter((s) => s.source_session_id === 'b-session');
    expect(b.at(-1)?.project_key).not.toBeNull();
  });

  it('keeps chunks within maxBytesPerChunk when sessions re-enter with long launch paths', async () => {
    const dir = await makeClaudeDir();
    const launch = '/' + 'l'.repeat(4000);
    for (const s of ['s-1', 's-2']) {
      await writeSession(dir, s, [
        line(s, 0, { type: 'user', cwd: launch, message: { content: 'x' } }),
        ...Array.from({ length: 6 }, (_, i) => usageLine(s, i + 1, `/other/${s}`)),
      ]);
    }
    const limit = 12_000;
    const chunks = await collect(
      scanner(dir),
      new Map(),
      scanOptions({ maxBytesPerChunk: limit, maxUsagePerChunk: 2 }),
    );
    chunks.forEach(assertValidChunk);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(Buffer.byteLength(JSON.stringify(c.records))).toBeLessThanOrEqual(limit);
    }
    for (const c of chunks) {
      for (const s of c.records.sessions) expect(s.project_key).not.toBeNull();
    }
    expect(merged(chunks).usage).toHaveLength(12);
  });

  it('resumes exactly after committing a chunk that ends inside a second file', async () => {
    const dir = await makeClaudeDir();
    await addTranscript(dir, 'basic-session.jsonl', sid(1));
    await addTranscript(dir, 'multi-model.jsonl', sid(3));
    const sc = scanner(dir);
    const opts = scanOptions({ maxUsagePerChunk: 2 });
    const chunks = await collect(sc, new Map(), opts);
    chunks.forEach(assertValidChunk);
    expect(merged(chunks).usage).toHaveLength(7);
    for (let k = 0; k < chunks.length; k += 1) {
      const rest = await collect(sc, commit(new Map(), chunks.slice(0, k + 1)), opts);
      rest.forEach(assertValidChunk);
      expect(merged(rest).usage.map((u) => u.source_message_id)).toEqual(
        merged(chunks.slice(k + 1)).usage.map((u) => u.source_message_id),
      );
    }
  });
});

describe('scanner — well-formed strings and timestamps', () => {
  it('never emits lone surrogates in names, paths or session fields', async () => {
    const dir = await makeClaudeDir();
    const cwd = '/home/dev/' + 'a'.repeat(190) + '😀';
    await writeSession(dir, 'w-session', [
      line('w-session', 0, {
        type: 'user',
        cwd,
        gitBranch: 'feat-\uD83D',
        message: { content: 'hi \uDE00' },
      }),
    ]);
    const chunks = await collect(scanner(dir));
    const body = JSON.stringify(chunks.map((c) => c.records));
    expect(LONE.test(JSON.parse(body) && body)).toBe(false);
    const r = merged(chunks);
    expect(LONE.test(r.projects[0]!.name)).toBe(false);
    expect(r.projects[0]!.name.length).toBeLessThanOrEqual(191);
    expect(r.sessions[0]!.git_branch).toBe('feat-�');
    expect(r.messages[0]!.content).toBe('hi �');
  });

  it('ignores non-UTC or out-of-range timestamps', async () => {
    const dir = await makeClaudeDir();
    await writeSession(dir, 't-session', [
      line('t-session', 0, { cwd: '/t', timestamp: '2026-09-22T06:00:00' }),
      line('t-session', 1, { cwd: '/t', timestamp: '2026-09-22T06:00:00+06:00' }),
      line('t-session', 2, { cwd: '/t', timestamp: '1970-01-01T00:00:00.000Z' }),
      line('t-session', 3, { cwd: '/t' }),
    ]);
    const r = merged(await collect(scanner(dir)));
    expect(r.sessions[0]).toMatchObject({ first_seen_at: ts(3), last_seen_at: ts(3) });
  });

  it('does not send the pre-since launch time in the project record', async () => {
    const dir = await makeClaudeDir();
    await addTranscript(dir, 'basic-session.jsonl', sid(1));
    const since = new Date('2026-09-22T06:51:00.000Z');
    const chunks = await collect(scanner(dir), new Map(), scanOptions({ since }));
    const r = merged(chunks);
    expect(r.projects).toHaveLength(1);
    expect(Date.parse(r.projects[0]!.first_seen_at)).toBeGreaterThanOrEqual(since.getTime());
    expect(r.sessions[0]!.project_key).toBe(r.projects[0]!.project_key);
  });

  it('project OFF sends no project key even with a known launch cwd', async () => {
    const dir = await makeClaudeDir();
    await mkdir(dir.projectDir, { recursive: true });
    await addTranscript(dir, 'basic-session.jsonl', sid(1));
    const r = merged(
      await collect(
        scanner(dir),
        new Map(),
        scanOptions({ settings: settings({ project: false }) }),
      ),
    );
    expect(r.sessions[0]!.project_key).toBeNull();
    expect(r.projects).toEqual([]);
  });
});

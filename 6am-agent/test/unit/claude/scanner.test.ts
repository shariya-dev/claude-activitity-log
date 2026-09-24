import { stat, truncate, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fileIdentity, nodeFs, type FsLike } from '../../../src/core/claude/fs.js';
import { createClaudeScanner, type ClaudeScannerDeps } from '../../../src/core/claude/scanner.js';
import {
  projectKeyFromCwd,
  projectKeyFromRemote,
  sha256Hex,
} from '../../../src/core/detect/keys.js';
import type { FileCheckpoint } from '../../../src/core/contract/index.js';
import {
  addSubagentFixture,
  addTranscript,
  appendText,
  assertValidChunk,
  collect,
  commit,
  DEVICE_UID,
  expected,
  fixtureText,
  makeClaudeDir,
  merged,
  normalized,
  pick,
  scanOptions,
  settings,
  sid,
  spyFs,
  writeText,
  type ClaudeDir,
} from './helpers.js';

const DEMO = '/home/dev/projects/demo-app';

function scanner(dir: ClaudeDir, over: Partial<ClaudeScannerDeps> = {}) {
  return createClaudeScanner({
    source: dir.source,
    deviceUid: () => DEVICE_UID,
    readGitRemote: async () => null,
    ...over,
  });
}

async function checkpointAt(file: string, offset: number, size = offset): Promise<FileCheckpoint> {
  const s = await stat(file);
  return { path: file, fileIdentity: fileIdentity(s), size, mtimeMs: s.mtimeMs, offset };
}

describe('claude scanner — H02 fixtures', () => {
  it.each([
    ['basic-session.jsonl', 1, 'basic-session.json'],
    ['multi-model.jsonl', 3, 'multi-model.json'],
    ['split-usage-growing.jsonl', 5, 'split-usage-growing.json'],
  ])('%s matches its expected output', async (fixture, n, exp) => {
    const dir = await makeClaudeDir();
    const file = await addTranscript(dir, fixture, sid(n));
    const chunks = await collect(scanner(dir));
    const want = await expected(exp);
    expect(chunks).toHaveLength(1);
    chunks.forEach(assertValidChunk);
    expect(normalized(chunks)).toEqual(pick(want));
    const s = await stat(file);
    expect(chunks[0]!.checkpoints).toEqual([
      {
        path: file,
        fileIdentity: fileIdentity(s),
        size: s.size,
        mtimeMs: s.mtimeMs,
        offset: want.consumedBytes,
      },
    ]);
    expect(chunks[0]!.stats).toEqual({
      filesRead: 1,
      linesRead: want.linesTotal,
      linesSkipped: want.linesSkipped,
    });
  });

  it('counts a message split over 3 lines once (dedup by message.id)', async () => {
    const dir = await makeClaudeDir();
    await addTranscript(dir, 'basic-session.jsonl', sid(1));
    const usage = merged(await collect(scanner(dir))).usage;
    expect(usage.filter((u) => u.source_message_id === 'msg_01FIXTUREbasic0000000001')).toEqual([
      expect.objectContaining({ input_tokens: 3, output_tokens: 85 }),
    ]);
  });

  it('merges subagent transcripts into the parent session as sidechain usage', async () => {
    const dir = await makeClaudeDir();
    const { main, sub } = await addSubagentFixture(dir);
    const chunks = await collect(scanner(dir));
    const want = await expected('subagent.json');
    chunks.forEach(assertValidChunk);
    expect(normalized(chunks)).toEqual(pick(want));
    const offsets = Object.fromEntries(
      chunks.flatMap((c) => c.checkpoints).map((cp) => [cp.path, cp.offset]),
    );
    expect(offsets).toEqual({ [main]: 2249, [sub]: 4026 });
  });

  it('skips malformed lines, leaves the partial tail, then consumes its completion', async () => {
    const dir = await makeClaudeDir();
    const file = await addTranscript(dir, 'malformed.jsonl', sid(4));
    const sc = scanner(dir);
    const first = await collect(sc);
    const want = await expected('malformed.json');
    expect(normalized(first)).toEqual(pick(want));
    expect(first[0]!.stats).toMatchObject({ linesRead: 5, linesSkipped: 2 });
    expect(first[0]!.checkpoints[0]).toMatchObject({ offset: 1896, size: 2096 });

    await appendText(file, await fixtureText('malformed.completion'));
    const second = await collect(sc, commit(new Map(), first));
    const after = await expected('malformed-after-completion.json');
    second.forEach(assertValidChunk);
    expect(normalized(second)).toEqual(pick(after));
    expect(second[0]!.checkpoints[0]).toMatchObject({ offset: 2823, size: 2823 });
  });

  it('reads incrementally from a checkpoint (basic-session from byte 4419)', async () => {
    const dir = await makeClaudeDir();
    const file = await addTranscript(dir, 'basic-session.jsonl', sid(1));
    const chunks = await collect(scanner(dir), new Map([[file, await checkpointAt(file, 4419)]]));
    chunks.forEach(assertValidChunk);
    expect(normalized(chunks)).toEqual(pick(await expected('basic-session-incremental.json')));
    expect(chunks[0]!.stats.linesRead).toBe(13);
    expect(chunks[0]!.checkpoints[0]!.offset).toBe(11290);
  });
});

describe('claude scanner — incremental behaviour', () => {
  it('detects an updated session: appended lines yield only new usage and the new offset', async () => {
    const dir = await makeClaudeDir();
    const lines = (await fixtureText('split-usage-growing.jsonl')).split('\n').slice(0, -1);
    const file = path.join(dir.projectDir, `${sid(5)}.jsonl`);
    await writeText(file, lines.slice(0, 5).join('\n') + '\n');
    const sc = scanner(dir);
    const first = await collect(sc);
    expect(merged(first).usage.map((u) => u.source_message_id)).toEqual([
      'msg_01FIXTUREgrowing000000001',
    ]);

    await appendText(file, lines.slice(5).join('\n') + '\n');
    const second = await collect(sc, commit(new Map(), first));
    const r = merged(second);
    expect(r.usage.map((u) => u.source_message_id)).toEqual(['msg_01FIXTUREgrowing000000002']);
    expect(r.usage[0]).toMatchObject({
      input_tokens: 4,
      output_tokens: 64,
      cache_read_tokens: 9500,
    });
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]!.project_key).toBeNull(); // launch line not re-read
    expect(second[0]!.checkpoints[0]!.offset).toBe((await stat(file)).size);
  });

  it('stat fast path: an unchanged file is not opened and yields nothing', async () => {
    const dir = await makeClaudeDir();
    await addTranscript(dir, 'basic-session.jsonl', sid(1));
    await addSubagentFixture(dir);
    const fs = spyFs();
    const sc = scanner(dir, { fs });
    const first = await collect(sc);
    expect(fs.open).toHaveBeenCalledTimes(3);
    fs.open.mockClear();
    const second = await collect(sc, commit(new Map(), first));
    expect(fs.open).not.toHaveBeenCalled();
    expect(second).toEqual([]);
  });

  it('restarts from 0 when the file shrank below the checkpoint offset', async () => {
    const dir = await makeClaudeDir();
    const file = await addTranscript(dir, 'multi-model.jsonl', sid(3));
    const cp = await checkpointAt(file, 999_999, 999_999);
    const chunks = await collect(scanner(dir), new Map([[file, cp]]));
    expect(merged(chunks).usage).toHaveLength(4);
    expect(merged(chunks).sessions[0]!.project_key).not.toBeNull();
  });

  it('restarts from 0 when the file identity changed', async () => {
    const dir = await makeClaudeDir();
    const file = await addTranscript(dir, 'multi-model.jsonl', sid(3));
    const cp = { ...(await checkpointAt(file, 5769, 5769)), fileIdentity: '1:2' };
    const chunks = await collect(scanner(dir), new Map([[file, cp]]));
    expect(merged(chunks).usage).toHaveLength(4);
    expect(chunks[0]!.checkpoints[0]!.fileIdentity).toBe(fileIdentity(await stat(file)));
  });

  it('re-reads a rewritten file of the same identity whose size changed below the offset', async () => {
    const dir = await makeClaudeDir();
    const file = await addTranscript(dir, 'multi-model.jsonl', sid(3));
    const sc = scanner(dir);
    const committed = commit(new Map(), await collect(sc));
    await truncate(file, 0);
    await appendText(file, (await fixtureText('multi-model.jsonl')).split('\n')[0] + '\n');
    const chunks = await collect(sc, committed);
    expect(merged(chunks).messages).toHaveLength(1);
  });

  it('skips an unreadable file without moving its checkpoint', async () => {
    const dir = await makeClaudeDir();
    const bad = await addTranscript(dir, 'basic-session.jsonl', sid(1));
    await addTranscript(dir, 'multi-model.jsonl', sid(3));
    const fs: FsLike = {
      ...nodeFs,
      open: async (p, f) => {
        if (p === bad) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
        return nodeFs.open(p, f);
      },
    };
    const chunks = await collect(scanner(dir, { fs }));
    expect(chunks.flatMap((c) => c.checkpoints).map((c) => c.path)).not.toContain(bad);
    expect(merged(chunks).usage).toHaveLength(4);
  });

  it('keeps the consumed part when a read fails midway', async () => {
    const dir = await makeClaudeDir();
    const line = (await fixtureText('multi-model.jsonl')).split('\n')[0]! + '\n';
    const file = path.join(dir.projectDir, `${sid(3)}.jsonl`);
    await writeFile(file, line.repeat(Math.ceil((300 * 1024) / line.length)));
    let reads = 0;
    const fs: FsLike = {
      ...nodeFs,
      open: async (p, f) => {
        const h = await nodeFs.open(p, f);
        return {
          read: async (buf, off, len, pos) => {
            reads += 1;
            if (reads > 1) throw new Error('EIO');
            return h.read(buf, off, len, pos);
          },
          close: () => h.close(),
        };
      },
    };
    const opts = scanOptions({ settings: settings({ prompt: false }) });
    const chunks = await collect(scanner(dir, { fs }), new Map(), opts);
    const lineBytes = Buffer.byteLength(line);
    const consumed = Math.floor((256 * 1024) / lineBytes) * lineBytes;
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.checkpoints).toEqual([
      expect.objectContaining({ path: file, offset: consumed, size: consumed }),
    ]);
    expect(chunks[0]!.stats.linesRead).toBe(consumed / lineBytes);
  });

  it('ignores files that vanish between listing and stat', async () => {
    const dir = await makeClaudeDir();
    const file = await addTranscript(dir, 'multi-model.jsonl', sid(3));
    const fs: FsLike = {
      ...nodeFs,
      stat: async (p) => {
        if (p === file) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return nodeFs.stat(p);
      },
    };
    expect(await collect(scanner(dir, { fs }))).toEqual([]);
  });
});

describe('claude scanner — since (initial range)', () => {
  it('skips lines before since but still resolves the launch project', async () => {
    const dir = await makeClaudeDir();
    await addTranscript(dir, 'basic-session.jsonl', sid(1));
    const since = new Date('2026-09-22T06:51:00.000Z');
    const chunks = await collect(scanner(dir), new Map(), scanOptions({ since }));
    chunks.forEach(assertValidChunk);
    const r = merged(chunks);
    expect(r.usage.map((u) => u.source_message_id)).toEqual(['msg_01FIXTUREbasic0000000003']);
    expect(r.messages.map((m) => m.content)).toEqual([
      'Lorem ipsum dolor sit amet, second prompt.',
    ]);
    expect(r.sessions[0]).toMatchObject({
      first_seen_at: '2026-09-22T06:51:10.000Z',
      project_key: projectKeyFromCwd(DEVICE_UID, DEMO),
    });
    expect(chunks[0]!.checkpoints[0]!.offset).toBe(11290);
  });

  it('checkpoints files last modified before since at EOF without reading them', async () => {
    const dir = await makeClaudeDir();
    const file = await addTranscript(dir, 'basic-session.jsonl', sid(1));
    await utimes(file, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    const fs = spyFs();
    const chunks = await collect(
      scanner(dir, { fs }),
      new Map(),
      scanOptions({ since: new Date('2026-09-01T00:00:00Z') }),
    );
    expect(fs.open).not.toHaveBeenCalled();
    expect(chunks).toHaveLength(1);
    expect(merged(chunks)).toEqual({
      accounts: [],
      projects: [],
      sessions: [],
      usage: [],
      messages: [],
    });
    expect(chunks[0]!.checkpoints[0]).toMatchObject({ offset: 11290, size: 11290 });
  });
});

describe('claude scanner — category gating', () => {
  async function scanWith(categories: Parameters<typeof settings>[0], deps = {}) {
    const dir = await makeClaudeDir();
    await addTranscript(dir, 'basic-session.jsonl', sid(1));
    const readGitRemote = vi.fn(async () => 'git@GitHub.com:example/demo-app.git');
    const fs = spyFs();
    const chunks = await collect(
      scanner(dir, { readGitRemote, fs, ...deps }),
      new Map(),
      scanOptions({ settings: settings(categories) }),
    );
    chunks.forEach(assertValidChunk);
    return { dir, chunks, r: merged(chunks), readGitRemote, fs };
  }

  it('git OFF: never calls readGitRemote; branch and remote are null', async () => {
    const { r, readGitRemote } = await scanWith({ git: false });
    expect(readGitRemote).not.toHaveBeenCalled();
    expect(r.sessions[0]!.git_branch).toBeNull();
    expect(r.projects[0]).toMatchObject({
      git_remote: null,
      name: 'demo-app',
      project_key: projectKeyFromCwd(DEVICE_UID, DEMO),
    });
  });

  it('git ON: project key derives from the normalized remote', async () => {
    const { r, readGitRemote } = await scanWith({ git: true });
    expect(readGitRemote).toHaveBeenCalledTimes(1);
    expect(readGitRemote).toHaveBeenCalledWith(DEMO);
    expect(r.projects[0]).toMatchObject({
      git_remote: 'github.com/example/demo-app',
      name: 'demo-app',
      project_key: projectKeyFromRemote('github.com/example/demo-app'),
    });
    expect(r.sessions[0]!.git_branch).toBe('feature/demo');
  });

  it('git ON without a remote, or a failing reader, falls back to the device+cwd key', async () => {
    const none = await scanWith({ git: true }, { readGitRemote: async () => null });
    const failing = await scanWith(
      { git: true },
      {
        readGitRemote: async () => {
          throw new Error('EPERM');
        },
      },
    );
    for (const { r } of [none, failing]) {
      expect(r.projects[0]!.project_key).toBe(projectKeyFromCwd(DEVICE_UID, DEMO));
    }
  });

  it('git ON uses the default .git/config reader through the injected fs', async () => {
    const dir = await makeClaudeDir();
    await addTranscript(dir, 'basic-session.jsonl', sid(1));
    const fs = spyFs();
    const sc = createClaudeScanner({ source: dir.source, deviceUid: () => DEVICE_UID, fs });
    const chunks = await collect(sc);
    expect(fs.readFile).toHaveBeenCalledWith(path.join(DEMO, '.git', 'config'), 'utf8');
    expect(merged(chunks).projects[0]!.git_remote).toBeNull();
  });

  it('project OFF: no projects, null project keys, and no git remote reads', async () => {
    const { r, readGitRemote } = await scanWith({ project: false, git: true });
    expect(r.projects).toEqual([]);
    expect(r.sessions[0]!.project_key).toBeNull();
    expect(readGitRemote).not.toHaveBeenCalled();
    expect(r.sessions[0]!.git_branch).toBe('feature/demo');
  });

  it('account OFF: the global config is never read', async () => {
    const { r, fs, dir } = await scanWith({ account: false });
    expect(fs.readFile).not.toHaveBeenCalledWith(dir.source.globalConfigPath, 'utf8');
    expect(r.accounts).toEqual([]);
    expect(r.sessions[0]!.account_key).toBeNull();
  });

  it('account ON: one account record, attributed to the sessions read', async () => {
    const { r } = await scanWith({ account: true, git: false });
    const key = sha256Hex('0b7c1a2e-4f3d-4a8b-9c1d-0000000000a1');
    expect(r.accounts).toEqual([expect.objectContaining({ account_key: key })]);
    expect(r.sessions[0]!.account_key).toBe(key);
  });

  it('account ON without oauthAccount or global config: no account', async () => {
    const dir = await makeClaudeDir('claude-no-account.json');
    await addTranscript(dir, 'basic-session.jsonl', sid(1));
    expect(merged(await collect(scanner(dir))).accounts).toEqual([]);
    const bare = await makeClaudeDir(null);
    await addTranscript(bare, 'basic-session.jsonl', sid(1));
    expect(merged(await collect(scanner(bare))).sessions[0]!.account_key).toBeNull();
  });

  it('model OFF: usage and session models are null', async () => {
    const { r } = await scanWith({ model: false });
    expect(r.usage.every((u) => u.model === null)).toBe(true);
    expect(r.sessions[0]!.model).toBeNull();
  });

  it('usage OFF: no usage records, sessions still sent', async () => {
    const { r } = await scanWith({ usage: false });
    expect(r.usage).toEqual([]);
    expect(r.sessions).toHaveLength(1);
  });

  it('prompt OFF: no messages', async () => {
    const { r } = await scanWith({ prompt: false });
    expect(r.messages).toEqual([]);
  });

  it('session OFF: nothing is read or yielded', async () => {
    const { chunks, fs } = await scanWith({ session: false });
    expect(chunks).toEqual([]);
    expect(fs.readdir).not.toHaveBeenCalled();
    expect(fs.open).not.toHaveBeenCalled();
  });

  it('project keys are deterministic across scanners', async () => {
    const a = await scanWith({ git: false });
    const b = await scanWith({ git: false });
    expect(a.r.projects[0]!.project_key).toBe(b.r.projects[0]!.project_key);
    expect(a.r.projects[0]!.project_key).toBe(
      sha256Hex(`${DEVICE_UID}\n/home/dev/projects/demo-app`),
    );
  });
});

describe('claude scanner — chunking', () => {
  async function chunkedScan(
    opts: Parameters<typeof scanOptions>[0],
    setup?: (d: ClaudeDir) => Promise<void>,
  ) {
    const dir = await makeClaudeDir();
    if (setup) await setup(dir);
    else await addTranscript(dir, 'multi-model.jsonl', sid(3));
    const sc = scanner(dir);
    const chunks = await collect(sc, new Map(), scanOptions(opts));
    chunks.forEach(assertValidChunk);
    return { dir, sc, chunks };
  }

  it('respects maxUsagePerChunk and each chunk checkpoint covers exactly its lines', async () => {
    const { sc, chunks } = await chunkedScan({ maxUsagePerChunk: 1 });
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks.every((c) => c.records.usage.length <= 1)).toBe(true);
    const full = normalized(chunks);
    const want = pick(await expected('multi-model.json'));
    expect(full.usage).toEqual(want.usage);
    expect(full.messages).toEqual(want.messages);

    // Committing chunks 0..k and rescanning yields exactly the usage of chunks k+1.. .
    for (let k = 0; k < chunks.length; k += 1) {
      const rest = await collect(sc, commit(new Map(), chunks.slice(0, k + 1)), scanOptions());
      const expectedRest = merged(chunks.slice(k + 1)).usage.map((u) => u.source_message_id);
      expect(merged(rest).usage.map((u) => u.source_message_id)).toEqual(expectedRest);
      const expectedMsgs = merged(chunks.slice(k + 1)).messages.map((m) => m.source_message_id);
      expect(merged(rest).messages.map((m) => m.source_message_id)).toEqual(expectedMsgs);
    }
    const offsets = chunks.map((c) => c.checkpoints[0]!.offset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(offsets.at(-1)).toBe(5769);
    expect(
      chunks.slice(0, -1).every((c) => c.checkpoints[0]!.size === c.checkpoints[0]!.offset),
    ).toBe(true);
  });

  it('respects maxMessagesPerChunk', async () => {
    const { chunks } = await chunkedScan({ maxMessagesPerChunk: 1 });
    expect(chunks.every((c) => c.records.messages.length <= 1)).toBe(true);
    expect(merged(chunks).messages).toHaveLength(3);
  });

  it('respects maxSessionsPerChunk across files and resends the account per chunk', async () => {
    const { chunks } = await chunkedScan({ maxSessionsPerChunk: 1 }, async (dir) => {
      await addTranscript(dir, 'basic-session.jsonl', sid(1));
      await addTranscript(dir, 'multi-model.jsonl', sid(3));
    });
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.records.sessions.length)).toEqual([1, 1]);
    expect(chunks.map((c) => c.records.accounts.length)).toEqual([1, 1]);
    expect(chunks.map((c) => c.records.projects.length)).toEqual([1, 1]);
  });

  it('respects maxBytesPerChunk', async () => {
    const { chunks } = await chunkedScan({ maxBytesPerChunk: 4000 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(Buffer.byteLength(JSON.stringify(c.records))).toBeLessThan(4000);
    expect(merged(chunks).usage).toHaveLength(4);
  });

  it('re-sends a session that spans chunks with its cumulative state and launch project', async () => {
    const { chunks } = await chunkedScan({ maxUsagePerChunk: 1 });
    const last = chunks.at(-1)!.records;
    expect(last.sessions[0]).toMatchObject({
      first_seen_at: '2026-09-20T09:00:00.000Z',
      project_key: projectKeyFromCwd(DEVICE_UID, DEMO),
      model: 'claude-opus-5',
    });
    expect(last.projects.map((p) => p.path)).toEqual([DEMO]);
  });

  it('keeps split lines of one message together when they fit, merges by max across the scan', async () => {
    const { chunks } = await chunkedScan({ maxUsagePerChunk: 1 }, async (dir) => {
      await addTranscript(dir, 'split-usage-growing.jsonl', sid(5));
    });
    const growing = merged(chunks).usage.filter(
      (u) => u.source_message_id === 'msg_01FIXTUREgrowing000000001',
    );
    expect(growing).toEqual([expect.objectContaining({ output_tokens: 250 })]);
  });
});

describe('claude scanner — version and activity', () => {
  it('reports the newest version and activity after a scan', async () => {
    const dir = await makeClaudeDir();
    await addTranscript(dir, 'basic-session.jsonl', sid(1));
    await addTranscript(dir, 'multi-model.jsonl', sid(3));
    const sc = scanner(dir);
    await collect(sc);
    expect(await sc.claudeCodeVersion()).toBe('2.1.274');
    expect(await sc.lastLocalActivityAt()).toEqual(new Date('2026-09-22T06:51:20.000Z'));
  });

  it('falls back to the tail of the newest file before any scan', async () => {
    const dir = await makeClaudeDir();
    const older = await addTranscript(dir, 'basic-session.jsonl', sid(1));
    await addTranscript(dir, 'multi-model.jsonl', sid(3));
    await utimes(older, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    const sc = scanner(dir);
    expect(await sc.lastLocalActivityAt()).toEqual(new Date('2026-09-20T09:05:08.000Z'));
    expect(await sc.claudeCodeVersion()).toBe('2.1.274');
  });

  it('parses only whole lines when the newest file is larger than one block', async () => {
    const dir = await makeClaudeDir();
    const line = (await fixtureText('multi-model.jsonl')).split('\n')[0]!;
    const big = path.join(dir.projectDir, `${sid(3)}.jsonl`);
    await writeFile(big, `${line}\n`.repeat(Math.ceil((300 * 1024) / line.length)));
    expect(await scanner(dir).claudeCodeVersion()).toBe('2.1.274');
  });

  it('returns null when there is no transcript or the dir is unreadable', async () => {
    const dir = await makeClaudeDir();
    const sc = scanner(dir);
    expect(await sc.claudeCodeVersion()).toBeNull();
    expect(await sc.lastLocalActivityAt()).toBeNull();
    const broken = scanner(dir, {
      fs: {
        ...nodeFs,
        readdir: async () => {
          throw new Error('EACCES');
        },
      },
    });
    expect(await broken.claudeCodeVersion()).toBeNull();
  });

  it('returns null when the newest file cannot be read', async () => {
    const dir = await makeClaudeDir();
    await addTranscript(dir, 'multi-model.jsonl', sid(3));
    const sc = scanner(dir, {
      fs: {
        ...nodeFs,
        open: async () => {
          throw new Error('EACCES');
        },
      },
    });
    expect(await sc.claudeCodeVersion()).toBeNull();
  });
});

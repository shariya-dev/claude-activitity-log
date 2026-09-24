import { appendFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileIdentity } from '../../src/core/claude/fs.js';
import type { FileCheckpoint, ScanChunk } from '../../src/core/contract/index.js';
import {
  agentBreakdown,
  agentScanner,
  committed,
  DEMO_PROJECT,
  FIXTURES,
  fixtureSid,
  makeTempClaudeDir,
  oracleBreakdown,
  runOracle,
  scanAll,
  serverMerge,
  tokenSumsOf,
  usageOf,
  withoutCount,
  type TempClaudeDir,
} from './support.js';

async function expected(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(FIXTURES, 'expected', name), 'utf8'));
}

/** Lays out one H02 fixture as a Claude data dir; returns the main transcript path. */
async function layout(dir: TempClaudeDir, fixture: string): Promise<string> {
  if (fixture === 'subagent') {
    const id = fixtureSid(2);
    const main = dir.mainFile(DEMO_PROJECT, id);
    await dir.copyFixture(`subagent/${id}.jsonl`, main);
    const sub = dir.subagentFile(DEMO_PROJECT, id, 'agent-a1fixture');
    await dir.copyFixture(`subagent/${id}/subagents/agent-a1fixture.jsonl`, sub);
    await dir.copyFixture(
      `subagent/${id}/subagents/agent-a1fixture.meta.json`,
      path.join(path.dirname(sub), 'agent-a1fixture.meta.json'),
    );
    return main;
  }
  const n = { 'basic-session': 1, 'multi-model': 3, malformed: 4, 'split-usage-growing': 5 }[
    fixture
  ];
  const main = dir.mainFile(DEMO_PROJECT, fixtureSid(n!));
  await dir.copyFixture(`${fixture}.jsonl`, main);
  return main;
}

/** A Claude dir holding only the bytes of `file` from `offset` on: the oracle's view of a tail. */
async function tailDir(root: string, file: string, offset: number): Promise<string> {
  const tail = await makeTempClaudeDir();
  const rel = path.relative(path.join(root, 'projects'), file);
  await tail.write(path.join(tail.projectsDir, rel), (await readFile(file)).subarray(offset));
  return tail.root;
}

/** The oracle's diagnostics for each fixture, per the fixture README and expected files. */
const DIAGNOSTICS = {
  'basic-session': {
    files: 1,
    linesTotal: 22,
    linesSkipped: 0,
    partialTrailingBytes: 0,
    usageLines: 5,
    usageNoKey: 0,
    syntheticSkipped: 1,
    distinctMessages: 3,
    splitMessages: 1,
  },
  subagent: {
    files: 2,
    linesTotal: 9,
    linesSkipped: 0,
    partialTrailingBytes: 0,
    usageLines: 4,
    usageNoKey: 0,
    syntheticSkipped: 0,
    distinctMessages: 3,
    splitMessages: 1,
  },
  'multi-model': {
    files: 1,
    linesTotal: 8,
    linesSkipped: 0,
    partialTrailingBytes: 0,
    usageLines: 4,
    usageNoKey: 0,
    syntheticSkipped: 0,
    distinctMessages: 4,
    splitMessages: 0,
  },
  malformed: {
    files: 1,
    linesTotal: 5,
    linesSkipped: 2,
    partialTrailingBytes: 200,
    usageLines: 1,
    usageNoKey: 0,
    syntheticSkipped: 0,
    distinctMessages: 1,
    splitMessages: 0,
  },
  'split-usage-growing': {
    files: 1,
    linesTotal: 7,
    linesSkipped: 0,
    partialTrailingBytes: 0,
    usageLines: 5,
    usageNoKey: 0,
    syntheticSkipped: 0,
    distinctMessages: 2,
    splitMessages: 2,
  },
} as const;

const CASES = [
  ['basic-session', 'basic-session.json'],
  ['subagent', 'subagent.json'],
  ['multi-model', 'multi-model.json'],
  ['malformed', 'malformed.json'],
  ['split-usage-growing', 'split-usage-growing.json'],
] as const;

/** An expected-file line statistic: a number, or per-file numbers (subagent) summed. */
function expectedStat(exp: Record<string, unknown>, key: string): number {
  const v = exp[key] as number | Record<string, number>;
  return typeof v === 'number' ? v : Object.values(v).reduce((a, b) => a + b, 0);
}

/** The agent's line statistics summed over every chunk of one scan. */
function agentStats(chunks: ScanChunk[]) {
  const t = { filesRead: 0, linesRead: 0, linesSkipped: 0 };
  for (const c of chunks) {
    t.filesRead += c.stats.filesRead;
    t.linesRead += c.stats.linesRead;
    t.linesSkipped += c.stats.linesSkipped;
  }
  return t;
}

describe('H23 agent validation — H02 fixtures: agent usage == oracle == expected', () => {
  it.each(CASES)('%s', async (fixture, exp) => {
    const dir = await makeTempClaudeDir();
    await layout(dir, fixture);
    const chunks = await scanAll(agentScanner(dir.root));
    const usage = usageOf(chunks);
    const want = await expected(exp);

    // One scan, one chunk: the agent already emits one record per message.
    expect(serverMerge(usage)).toHaveLength(usage.length);
    const agent = agentBreakdown(usage);
    const report = runOracle(dir.root);
    const oracle = oracleBreakdown(report);

    expect(report.diagnostics).toEqual(DIAGNOSTICS[fixture]);
    for (const key of ['linesTotal', 'linesSkipped', 'partialTrailingBytes']) {
      expect(report.diagnostics[key], key).toBe(expectedStat(want, key));
    }
    expect(report.diagnostics.distinctMessages).toBe((want.usage as unknown[]).length);
    expect(agentStats(chunks)).toEqual({
      filesRead: report.diagnostics.files,
      linesRead: report.diagnostics.linesTotal,
      linesSkipped: report.diagnostics.linesSkipped,
    });

    expect(agent).toEqual(oracle);
    expect(withoutCount(agent.totals)).toEqual(tokenSumsOf(want));
    expect(agent.totals.message_count).toBe((want.usage as unknown[]).length);
  });

  it('all fixtures in one data dir', async () => {
    const dir = await makeTempClaudeDir();
    for (const [fixture] of CASES) await layout(dir, fixture);
    const chunks = await scanAll(agentScanner(dir.root));
    const agent = agentBreakdown(usageOf(chunks));
    const report = runOracle(dir.root);
    expect(agent).toEqual(oracleBreakdown(report));
    const sumOf = (k: keyof (typeof DIAGNOSTICS)['malformed']) =>
      Object.values(DIAGNOSTICS).reduce((a, d) => a + d[k], 0);
    expect(report.diagnostics).toEqual(
      Object.fromEntries(Object.keys(DIAGNOSTICS.malformed).map((k) => [k, sumOf(k as never)])),
    );
    expect(agentStats(chunks)).toEqual({ filesRead: 6, linesRead: 51, linesSkipped: 2 });
    expect(Object.keys(agent.sessions)).toHaveLength(5);
    expect(agent.totals).toMatchObject({ input_tokens: 94, message_count: 13 });
  });
});

describe('H23 agent validation — incremental fixtures', () => {
  it('basic-session read from checkpoint offset 4419 == oracle on the tail == expected', async () => {
    const dir = await makeTempClaudeDir();
    const file = await layout(dir, 'basic-session');
    const s = await stat(file);
    const cp: FileCheckpoint = {
      path: file,
      fileIdentity: fileIdentity(s),
      size: 4419,
      mtimeMs: s.mtimeMs,
      offset: 4419,
    };
    const chunks = await scanAll(agentScanner(dir.root), new Map([[file, cp]]));
    const agent = agentBreakdown(usageOf(chunks));
    const want = await expected('basic-session-incremental.json');

    // Byte 4419 starts the first line stamped 2026-09-22T06:50:33.100Z.
    const bySince = oracleBreakdown(runOracle(dir.root, { since: '2026-09-22T06:50:33.100Z' }));
    const tail = runOracle(await tailDir(dir.root, file, 4419));
    expect(agent).toEqual(bySince);
    expect(agent).toEqual(oracleBreakdown(tail));
    expect(withoutCount(agent.totals)).toEqual(tokenSumsOf(want));
    expect(tail.diagnostics).toEqual({
      files: 1,
      linesTotal: 13,
      linesSkipped: 0,
      partialTrailingBytes: 0,
      usageLines: 2,
      usageNoKey: 0,
      syntheticSkipped: 1,
      distinctMessages: 2,
      splitMessages: 0,
    });
    for (const key of ['linesTotal', 'linesSkipped', 'partialTrailingBytes']) {
      expect(tail.diagnostics[key], key).toBe(want[key]);
    }
    expect(agentStats(chunks)).toEqual({ filesRead: 1, linesRead: 13, linesSkipped: 0 });
    expect(agent.totals.message_count).toBe(2);
  });

  it('malformed + malformed.completion appended, second scan from the checkpoints', async () => {
    const dir = await makeTempClaudeDir();
    const file = await layout(dir, 'malformed');
    const sc = agentScanner(dir.root);
    const first = await scanAll(sc);
    const firstUsage = usageOf(first);
    expect(agentBreakdown(firstUsage)).toEqual(oracleBreakdown(runOracle(dir.root)));

    const offset = first.at(-1)!.checkpoints.at(-1)!.offset;
    await appendFile(file, await readFile(path.join(FIXTURES, 'malformed.completion')));
    const secondChunks = await scanAll(sc, committed(first));
    const second = usageOf(secondChunks);
    const agent = agentBreakdown(second);
    const want = await expected('malformed-after-completion.json');

    const tail = runOracle(await tailDir(dir.root, file, offset));
    expect(agent).toEqual(oracleBreakdown(tail));
    expect(withoutCount(agent.totals)).toEqual(tokenSumsOf(want));
    expect(tail.diagnostics).toEqual({
      files: 1,
      linesTotal: 1,
      linesSkipped: 0,
      partialTrailingBytes: 0,
      usageLines: 1,
      usageNoKey: 0,
      syntheticSkipped: 0,
      distinctMessages: 1,
      splitMessages: 0,
    });
    for (const key of ['linesTotal', 'linesSkipped', 'partialTrailingBytes']) {
      expect(tail.diagnostics[key], key).toBe(want[key]);
    }
    expect(agentStats(secondChunks)).toEqual({ filesRead: 1, linesRead: 1, linesSkipped: 0 });
    // Both scans together, after the server merge, equal the oracle over the whole file.
    expect(agentBreakdown(serverMerge([...firstUsage, ...second]))).toEqual(
      oracleBreakdown(runOracle(dir.root)),
    );
  });
});

import { appendFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileIdentity } from '../../src/core/claude/fs.js';
import type { FileCheckpoint } from '../../src/core/contract/index.js';
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

const CASES = [
  ['basic-session', 'basic-session.json'],
  ['subagent', 'subagent.json'],
  ['multi-model', 'multi-model.json'],
  ['malformed', 'malformed.json'],
  ['split-usage-growing', 'split-usage-growing.json'],
] as const;

describe('H23 agent validation — H02 fixtures: agent usage == oracle == expected', () => {
  it.each(CASES)('%s', async (fixture, exp) => {
    const dir = await makeTempClaudeDir();
    await layout(dir, fixture);
    const usage = usageOf(await scanAll(agentScanner(dir.root)));
    const want = await expected(exp);

    // One scan, one chunk: the agent already emits one record per message.
    expect(serverMerge(usage)).toHaveLength(usage.length);
    const agent = agentBreakdown(usage);
    const oracle = oracleBreakdown(runOracle(dir.root));

    expect(agent).toEqual(oracle);
    expect(withoutCount(agent.totals)).toEqual(tokenSumsOf(want));
    expect(agent.totals.message_count).toBe((want.usage as unknown[]).length);
  });

  it('all fixtures in one data dir', async () => {
    const dir = await makeTempClaudeDir();
    for (const [fixture] of CASES) await layout(dir, fixture);
    const usage = usageOf(await scanAll(agentScanner(dir.root)));
    const agent = agentBreakdown(usage);
    expect(agent).toEqual(oracleBreakdown(runOracle(dir.root)));
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
    const usage = usageOf(await scanAll(agentScanner(dir.root), new Map([[file, cp]])));
    const agent = agentBreakdown(usage);

    // Byte 4419 starts the first line stamped 2026-09-22T06:50:33.100Z.
    const bySince = oracleBreakdown(runOracle(dir.root, { since: '2026-09-22T06:50:33.100Z' }));
    const byTail = oracleBreakdown(runOracle(await tailDir(dir.root, file, 4419)));
    expect(agent).toEqual(bySince);
    expect(agent).toEqual(byTail);
    expect(withoutCount(agent.totals)).toEqual(
      tokenSumsOf(await expected('basic-session-incremental.json')),
    );
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
    const second = usageOf(await scanAll(sc, committed(first)));
    const agent = agentBreakdown(second);

    expect(agent).toEqual(oracleBreakdown(runOracle(await tailDir(dir.root, file, offset))));
    expect(withoutCount(agent.totals)).toEqual(
      tokenSumsOf(await expected('malformed-after-completion.json')),
    );
    // Both scans together, after the server merge, equal the oracle over the whole file.
    expect(agentBreakdown(serverMerge([...firstUsage, ...second]))).toEqual(
      oracleBreakdown(runOracle(dir.root)),
    );
  });
});

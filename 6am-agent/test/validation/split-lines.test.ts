import { appendFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { assistantLine, jsonl, userLine, type LineCtx } from './gen.js';
import {
  agentBreakdown,
  agentScanner,
  committed,
  makeTempClaudeDir,
  oracleBreakdown,
  runOracle,
  scanAll,
  serverMerge,
  usageOf,
  validationOptions,
} from './support.js';

const PROJECT = '-home-dev-projects-split-app';
const SID = 'e2300000-0000-4000-8000-000000000001';
const ctx: LineCtx = { sessionId: SID, cwd: '/home/dev/projects/split-app' };
const MODEL = 'claude-sonnet-5';
const A = 'msg_01H23SPLITaaaaaaaaaaaaaa';
const B = 'msg_01H23SPLITbbbbbbbbbbbbbb';

async function setup(lines: string[]) {
  const dir = await makeTempClaudeDir();
  const file = dir.mainFile(PROJECT, SID);
  await dir.write(file, jsonl(lines));
  return { dir, file };
}

describe('H23 agent validation — split lines', () => {
  it('(a) growing output and a trailing all-zero line merge to the per-field max', async () => {
    const { dir } = await setup([
      userLine(ctx, '2026-09-22T08:00:00.000Z'),
      assistantLine(ctx, '2026-09-22T08:00:03.000Z', A, MODEL, [6, 10, 500, 9000]),
      assistantLine(ctx, '2026-09-22T08:00:03.010Z', A, MODEL, [6, 10, 500, 9000]),
      assistantLine(ctx, '2026-09-22T08:00:03.020Z', A, MODEL, [6, 250, 500, 9000]),
      assistantLine(ctx, '2026-09-22T08:00:03.030Z', A, MODEL, [0, 0, 0, 0]),
      assistantLine(ctx, '2026-09-22T08:00:06.000Z', B, MODEL, [4, 64, 100, 9500]),
      assistantLine(ctx, '2026-09-22T08:00:06.005Z', B, MODEL, [0, 0, 0, 0]),
    ]);
    const usage = usageOf(await scanAll(agentScanner(dir.root)));
    expect(usage).toHaveLength(2);
    expect(usage.find((u) => u.source_message_id === A)).toMatchObject({
      input_tokens: 6,
      output_tokens: 250,
      cache_creation_tokens: 500,
      cache_read_tokens: 9000,
      recorded_at: '2026-09-22T08:00:03.000Z',
    });
    const agent = agentBreakdown(usage);
    expect(agent).toEqual(oracleBreakdown(runOracle(dir.root)));
    expect(agent.totals).toMatchObject({ output_tokens: 314, message_count: 2 });
  });

  it('(b) split lines straddling a chunk boundary: server merge == oracle, naive sum overcounts', async () => {
    const { dir } = await setup([
      userLine(ctx, '2026-09-22T09:00:00.000Z'),
      assistantLine(ctx, '2026-09-22T09:00:01.000Z', A, MODEL, [3, 20, 1000, 5000]),
      assistantLine(ctx, '2026-09-22T09:00:01.010Z', A, MODEL, [3, 20, 1000, 5000]),
      // A parallel request interleaves; with one usage record per chunk it forces a cut.
      assistantLine(ctx, '2026-09-22T09:00:01.500Z', B, MODEL, [2, 30, 0, 6000]),
      assistantLine(ctx, '2026-09-22T09:00:02.000Z', A, MODEL, [3, 400, 1000, 5000]),
    ]);
    const chunks = await scanAll(
      agentScanner(dir.root),
      new Map(),
      validationOptions({ maxUsagePerChunk: 1 }),
    );
    const usage = usageOf(chunks);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(usage.filter((u) => u.source_message_id === A)).toHaveLength(2);

    const oracle = oracleBreakdown(runOracle(dir.root));
    expect(agentBreakdown(serverMerge(usage))).toEqual(oracle);

    const naive = agentBreakdown(usage).totals;
    expect(naive.message_count).toBeGreaterThan(oracle.totals.message_count);
    expect(naive.cache_read_tokens).toBeGreaterThan(oracle.totals.cache_read_tokens);
    expect(naive.actual_consumed_tokens).toBeGreaterThan(oracle.totals.actual_consumed_tokens);
  });

  it('(c) split lines straddling an incremental scan (and org midnight): merge == oracle', async () => {
    // 17:59:59.990Z is 23:59:59.990 in Asia/Dhaka; the continuation lands on the next org day.
    const { dir, file } = await setup([
      userLine(ctx, '2026-09-22T17:59:58.000Z'),
      assistantLine(ctx, '2026-09-22T17:59:59.990Z', A, MODEL, [7, 15, 2000, 8000]),
      assistantLine(ctx, '2026-09-22T17:59:59.995Z', A, MODEL, [7, 15, 2000, 8000]),
    ]);
    const sc = agentScanner(dir.root);
    const first = await scanAll(sc);
    await appendFile(
      file,
      jsonl([
        assistantLine(ctx, '2026-09-22T18:00:00.010Z', A, MODEL, [7, 333, 2000, 8000]),
        assistantLine(ctx, '2026-09-22T18:00:00.020Z', A, MODEL, [0, 0, 0, 0]),
        userLine(ctx, '2026-09-22T18:00:05.000Z'),
        assistantLine(ctx, '2026-09-22T18:00:07.000Z', B, MODEL, [1, 9, 0, 8500]),
      ]),
    );
    const second = await scanAll(sc, committed(first));
    const usage = [...usageOf(first), ...usageOf(second)];
    expect(usage.filter((u) => u.source_message_id === A)).toHaveLength(2);

    const oracle = oracleBreakdown(runOracle(dir.root));
    const merged = agentBreakdown(serverMerge(usage));
    expect(merged).toEqual(oracle);
    // The message counts on the org day of its first line, as in the oracle.
    expect(Object.keys(merged.days).sort()).toEqual(['2026-09-22', '2026-09-23']);
    expect(merged.days['2026-09-22']).toMatchObject({ output_tokens: 333, message_count: 1 });

    const naive = agentBreakdown(usage).totals;
    expect(naive.message_count).toBe(3);
    expect(naive.total_token_activity).toBeGreaterThan(oracle.totals.total_token_activity);
  });

  it('control: a perturbed expectation fails (the comparison is not vacuous)', async () => {
    const { dir, file } = await setup([
      assistantLine(ctx, '2026-09-22T10:00:00.000Z', A, MODEL, [1, 2, 3, 4]),
    ]);
    const oracle = oracleBreakdown(runOracle(dir.root));
    await writeFile(
      file,
      jsonl([assistantLine(ctx, '2026-09-22T10:00:00.000Z', A, MODEL, [1, 2, 3, 5])]),
    );
    const agent = agentBreakdown(usageOf(await scanAll(agentScanner(dir.root))));
    expect(agent).not.toEqual(oracle);
  });
});

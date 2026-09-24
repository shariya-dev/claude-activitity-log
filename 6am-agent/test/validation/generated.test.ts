import { describe, expect, it } from 'vitest';
import { assistantLine, jsonl, seeded, userLine, type LineCtx, type Tokens } from './gen.js';
import {
  agentBreakdown,
  agentScanner,
  makeTempClaudeDir,
  oracleBreakdown,
  runOracle,
  scanAll,
  serverMerge,
  usageOf,
  validationOptions,
  type TempClaudeDir,
} from './support.js';

const MODELS = ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-5'] as const;
const START_MS = Date.parse('2026-09-20T15:00:00.000Z');

/**
 * 3 projects x 4 sessions over ~4 days: split lines (identical and growing, some ending in an
 * all-zero line), subagent files, a `<synthetic>` line, a malformed line and a partial tail.
 */
async function generate(dir: TempClaudeDir, seed: number) {
  const rnd = seeded(seed);
  let clock = START_MS;
  let msgSeq = 0;
  const tick = (maxMs: number) => new Date((clock += rnd.int(1, maxMs))).toISOString();
  const tokens = (): Tokens => [
    rnd.int(0, 50),
    rnd.int(1, 2000),
    rnd.int(0, 20_000),
    rnd.int(0, 200_000),
  ];

  function turn(ctx: LineCtx, lines: string[]) {
    lines.push(userLine(ctx, tick(90_000)));
    const id = `msg_01H23GEN${String(++msgSeq).padStart(16, '0')}`;
    const model = rnd.pick(MODELS);
    const t = tokens();
    const splits = rnd.int(1, 4);
    for (let i = 0; i < splits; i++) {
      const growing = rnd.next() < 0.5 && i < splits - 1;
      const out: Tokens = growing ? [t[0], Math.floor(t[1] / (splits - i)), t[2], t[3]] : t;
      lines.push(assistantLine(ctx, tick(40), id, model, out));
    }
    if (rnd.next() < 0.3) lines.push(assistantLine(ctx, tick(10), id, model, [0, 0, 0, 0]));
  }

  const files: string[] = [];
  for (let p = 1; p <= 3; p++) {
    const project = `-home-dev-projects-gen-app-${p}`;
    const cwd = `/home/dev/projects/gen-app-${p}`;
    for (let s = 1; s <= 4; s++) {
      const sessionId = `e2300000-0000-4000-8000-0000000${p}${String(s).padStart(4, '0')}`;
      const ctx: LineCtx = { sessionId, cwd };
      const main: string[] = [];
      const turns = rnd.int(3, 12);
      for (let i = 0; i < turns; i++) {
        turn(ctx, main);
        if (rnd.next() < 0.1) clock += rnd.int(6, 30) * 3_600_000; // idle gap, often past midnight
      }
      if (p === 1 && s === 1) {
        main.push(
          assistantLine(ctx, tick(100), `c2300000-synthetic-${s}`, '<synthetic>', [0, 0, 0, 0]),
        );
        main.push('{"type":"assistant","message":{"usage":');
      }
      let text = jsonl(main);
      if (p === 2 && s === 2) {
        text += assistantLine(
          ctx,
          tick(100),
          'msg_01H23GENpartialtail000000',
          MODELS[0],
          [9, 9, 9, 9],
        ); // no trailing newline: neither side may count it
      }
      const file = dir.mainFile(project, sessionId);
      await dir.write(file, text);
      files.push(file);

      if (s % 2 === 0) {
        const sub: string[] = [];
        const subCtx: LineCtx = { ...ctx, sidechain: true };
        const subTurns = rnd.int(2, 5);
        for (let i = 0; i < subTurns; i++) turn(subCtx, sub);
        const subFile = dir.subagentFile(project, sessionId, `agent-h23gen${p}${s}`);
        await dir.write(subFile, jsonl(sub));
        files.push(subFile);
      }
    }
  }
  return files;
}

describe('H23 agent validation — generated multi-session dataset', () => {
  it.each([1, 7, 2026])(
    'seed %i: agent == oracle on totals, sessions, days, models, session-days',
    async (seed) => {
      const dir = await makeTempClaudeDir();
      const files = await generate(dir, seed);
      const report = runOracle(dir.root);
      const oracle = oracleBreakdown(report);
      const usage = usageOf(await scanAll(agentScanner(dir.root)));
      const agent = agentBreakdown(usage);

      expect(report.diagnostics.files).toBe(files.length);
      expect(report.diagnostics.splitMessages).toBeGreaterThan(0);
      expect(report.diagnostics.syntheticSkipped).toBe(1);
      expect(report.diagnostics.partialTrailingBytes).toBeGreaterThan(0);
      expect(Object.keys(oracle.sessions)).toHaveLength(12);
      expect(Object.keys(oracle.models)).toHaveLength(3);
      expect(Object.keys(oracle.days).length).toBeGreaterThanOrEqual(3);

      expect(serverMerge(usage)).toHaveLength(usage.length);
      expect(agent.totals).toEqual(oracle.totals);
      expect(agent.sessions).toEqual(oracle.sessions);
      expect(agent.days).toEqual(oracle.days);
      expect(agent.models).toEqual(oracle.models);
      expect(agent.sessionDays).toEqual(oracle.sessionDays);
    },
  );

  it('small chunks (7 usage records each): server-merged agent output == oracle', async () => {
    const dir = await makeTempClaudeDir();
    await generate(dir, 42);
    const chunks = await scanAll(
      agentScanner(dir.root),
      new Map(),
      validationOptions({ maxUsagePerChunk: 7 }),
    );
    expect(chunks.length).toBeGreaterThan(5);
    expect(agentBreakdown(serverMerge(usageOf(chunks)))).toEqual(
      oracleBreakdown(runOracle(dir.root)),
    );
  });
});

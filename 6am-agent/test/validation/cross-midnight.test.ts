import { describe, expect, it } from 'vitest';
import { assistantLine, jsonl, userLine, type LineCtx } from './gen.js';
import {
  agentBreakdown,
  agentScanner,
  makeTempClaudeDir,
  oracleBreakdown,
  runOracle,
  scanAll,
  sessionDayKey,
  usageOf,
} from './support.js';

const SID = 'e2300000-0000-4000-8000-000000000002';
const ctx: LineCtx = { sessionId: SID, cwd: '/home/dev/projects/night-app' };
const M = (n: number) => `msg_01H23NIGHT${String(n).padStart(12, '0')}`;

async function nightDir() {
  const dir = await makeTempClaudeDir();
  await dir.write(
    dir.mainFile('-home-dev-projects-night-app', SID),
    jsonl([
      userLine(ctx, '2026-09-22T17:59:50.000Z'),
      // Asia/Dhaka (UTC+6) org midnight is 18:00:00.000Z.
      assistantLine(ctx, '2026-09-22T17:59:59.999Z', M(1), 'claude-sonnet-5', [1, 10, 100, 1000]),
      assistantLine(ctx, '2026-09-22T18:00:00.000Z', M(2), 'claude-sonnet-5', [2, 20, 200, 2000]),
      // UTC midnight: the same org day (06:00 in Dhaka), but two UTC days.
      assistantLine(ctx, '2026-09-22T23:59:59.999Z', M(3), 'claude-opus-5', [3, 30, 300, 3000]),
      assistantLine(ctx, '2026-09-23T00:00:00.000Z', M(4), 'claude-opus-5', [4, 40, 400, 4000]),
    ]),
  );
  return dir;
}

describe('H23 agent validation — cross-midnight day buckets', () => {
  it('splits at Asia/Dhaka midnight exactly as the oracle does', async () => {
    const dir = await nightDir();
    const usage = usageOf(await scanAll(agentScanner(dir.root)));
    const agent = agentBreakdown(usage);
    const oracle = oracleBreakdown(runOracle(dir.root));
    expect(agent).toEqual(oracle);
    expect(agent.days).toEqual(oracle.days);
    expect(agent.sessionDays).toEqual(oracle.sessionDays);
    expect(Object.keys(agent.days).sort()).toEqual(['2026-09-22', '2026-09-23']);
    expect(agent.days['2026-09-22']).toMatchObject({ input_tokens: 1, message_count: 1 });
    expect(agent.days['2026-09-23']).toMatchObject({ input_tokens: 9, message_count: 3 });
    expect(agent.sessionDays[sessionDayKey(SID, '2026-09-23')]).toMatchObject({
      total_token_activity: 2222 + 3333 + 4444,
    });
  });

  it('with --tz UTC the UTC-midnight pair splits instead, still equal to the oracle', async () => {
    const dir = await nightDir();
    const agent = agentBreakdown(usageOf(await scanAll(agentScanner(dir.root))), 'UTC');
    const oracle = oracleBreakdown(runOracle(dir.root, { tz: 'UTC' }));
    expect(agent).toEqual(oracle);
    expect(agent.days['2026-09-22']).toMatchObject({ input_tokens: 6, message_count: 3 });
    expect(agent.days['2026-09-23']).toMatchObject({ input_tokens: 4, message_count: 1 });
  });
});

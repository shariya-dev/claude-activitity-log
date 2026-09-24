import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assistantMessage, turn } from '../lib/lines.js';
import {
  appendLines,
  createScenario,
  payload,
  SESSION,
  SYNC_PATH,
  type Scenario,
  type TokenTotals,
} from '../setup.js';

const add = (
  a: TokenTotals,
  t: { input: number; output: number; cacheCreation: number; cacheRead: number },
): TokenTotals => {
  const actual = t.input + t.output + t.cacheCreation;
  return {
    input: a.input + t.input,
    output: a.output + t.output,
    cache_creation: a.cache_creation + t.cacheCreation,
    cache_read: a.cache_read + t.cacheRead,
    actual: a.actual + actual,
    total: a.total + actual + t.cacheRead,
  };
};
const ZERO: TokenTotals = {
  input: 0,
  output: 0,
  cache_creation: 0,
  cache_read: 0,
  actual: 0,
  total: 0,
};

// New lines in an existing session, a completed partial line and a brand-new session file:
// the next sync carries only those, and the stored session totals grow (PRD §16, §29).
describe('02 incremental sync (PRD §16 updated sessions, §29; AC11, AC12)', () => {
  let scn: Scenario;

  beforeAll(async () => {
    scn = await createScenario('s02');
    await scn.pair();
    const first = await scn.agent(['sync-now']);
    expect(first.code, first.stderr).toBe(0);
    expect(await scn.deviceCount('session_usage')).toBe(scn.expected.usageIds.length);
  });
  afterAll(async () => {
    await scn?.cleanup();
  });

  it('sends only the new records and stores only new rows', async () => {
    const before = {
      syncs: scn.captures(SYNC_PATH).length,
      usage: await scn.deviceCount('session_usage'),
      basic: (
        await scn.sql<{ started_at: string; last_activity_at: string }>(
          'SELECT started_at, last_activity_at FROM claude_sessions WHERE device_id = ? AND source_session_id = ?',
          [await scn.deviceId(), SESSION.basic],
        )
      )[0],
    };
    const fixtures = scn.ctx.fixturesDir;

    // Claude finishes writing the truncated last line of malformed.jsonl.
    appendFileSync(
      scn.sessionFile(SESSION.malformed),
      readFileSync(path.join(fixtures, 'malformed.completion')),
    );
    const completion = JSON.parse(
      readFileSync(path.join(fixtures, 'expected', 'malformed-after-completion.json'), 'utf8'),
    ) as { usage: { source_message_id: string }[]; tokenSums: TokenTotals };

    // A new turn in an existing session.
    const basicTokens = { input: 11, output: 220, cacheCreation: 330, cacheRead: 4400 };
    const basicTurn = turn(SESSION.basic, 'Lorem ipsum incremental prompt.', basicTokens, {
      splitLines: 2,
    });
    appendLines(scn.sessionFile(SESSION.basic), basicTurn.lines);

    // A new session file.
    const newSid = randomUUID();
    const t1 = { input: 5, output: 50, cacheCreation: 500, cacheRead: 5000 };
    const t2 = { input: 7, output: 70, cacheCreation: 0, cacheRead: 7000 };
    const newTurn = turn(newSid, 'Lorem ipsum new session.', t1);
    const followUp = assistantMessage(newSid, t2, { model: 'claude-opus-5', splitLines: 3 });
    appendLines(scn.sessionFile(newSid), [...newTurn.lines, ...followUp.lines]);

    const result = await scn.agent(['sync-now']);
    expect(result.code, result.stderr).toBe(0);

    const sent = scn.captures(SYNC_PATH).slice(before.syncs);
    expect(sent.length).toBeGreaterThan(0);
    const sentUsage = sent.flatMap((c) => payload(c).usage.map((u) => u.source_message_id)).sort();
    const newIds = [
      completion.usage[0]?.source_message_id,
      basicTurn.messageId,
      newTurn.messageId,
      followUp.id,
    ].sort();
    expect(sentUsage).toEqual(newIds);
    const sentSessions = [
      ...new Set(sent.flatMap((c) => payload(c).sessions.map((s) => s.source_session_id))),
    ].sort();
    expect(sentSessions).toEqual([SESSION.basic, SESSION.malformed, newSid].sort());
    for (const c of sent) expect(payload(c).sync.is_initial).toBe(false);

    const id = await scn.deviceId();
    expect(await scn.deviceCount('session_usage')).toBe(before.usage + 4);
    expect(await scn.deviceCount('claude_sessions')).toBe(scn.expected.sessions.length + 1);
    const dupes = await scn.sql(
      'SELECT claude_session_id, source_message_id FROM session_usage WHERE device_id = ? GROUP BY 1, 2 HAVING COUNT(*) > 1',
      [id],
    );
    expect(dupes).toEqual([]);

    const totals = await scn.sessionTotals();
    expect(totals[SESSION.basic]).toMatchObject(
      add(scn.expected.perSession[SESSION.basic] ?? ZERO, basicTokens),
    );
    const malformedBefore = scn.expected.perSession[SESSION.malformed] ?? ZERO;
    expect(totals[SESSION.malformed]).toMatchObject({
      input: malformedBefore.input + completion.tokenSums.input,
      output: malformedBefore.output + completion.tokenSums.output,
      actual: malformedBefore.actual + completion.tokenSums.actual,
      total: malformedBefore.total + completion.tokenSums.total,
    });
    expect(totals[newSid]).toMatchObject(add(add(ZERO, t1), t2));
    // Untouched sessions keep their totals.
    for (const sid of [SESSION.subagent, SESSION.multiModel, SESSION.splitUsage]) {
      expect(totals[sid]).toMatchObject(scn.expected.perSession[sid] ?? ZERO);
    }

    const [basicAfter] = await scn.sql<{ started_at: string; last_activity_at: string }>(
      'SELECT started_at, last_activity_at FROM claude_sessions WHERE device_id = ? AND source_session_id = ?',
      [id, SESSION.basic],
    );
    expect(basicAfter?.started_at).toBe(before.basic?.started_at);
    expect((basicAfter?.last_activity_at ?? '') > (before.basic?.last_activity_at ?? '')).toBe(
      true,
    );
  });

  it('a sync with nothing new sends nothing', async () => {
    const syncs = scn.captures(SYNC_PATH).length;
    const result = await scn.agent(['sync-now']);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Sync nothing/);
    expect(scn.captures(SYNC_PATH)).toHaveLength(syncs);
  });
});

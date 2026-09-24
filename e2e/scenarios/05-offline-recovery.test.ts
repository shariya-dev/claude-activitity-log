import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { turn } from '../lib/lines.js';
import {
  appendLines,
  createScenario,
  SESSION,
  SYNC_PATH,
  waitFor,
  type Daemon,
  type Scenario,
} from '../setup.js';

// The backend is unreachable while the developer keeps working. Nothing is lost: once the network
// is back, the running agent uploads everything from its last acknowledged position (PRD §27).
describe('05 offline recovery (AC14, PRD §27, §55)', () => {
  let scn: Scenario;
  let daemon: Daemon;

  beforeAll(async () => {
    scn = await createScenario('s05');
    await scn.pair();
    daemon = await scn.startAgentDaemon();
    const ack = await waitFor('the initial sync', () => scn.acknowledgedSyncs()[0]);
    await scn.waitForCommit(ack);
  });
  afterAll(async () => {
    await daemon?.stop();
    await scn?.cleanup();
  });

  it('keeps activity recorded while offline and uploads all of it when back online', async () => {
    const committed = scn.checkpoints();
    const usageBefore = await scn.deviceCount('session_usage');
    expect(usageBefore).toBe(scn.expected.usageIds.length);

    scn.proxy.setMode('down');
    const tokens = { input: 2, output: 20, cacheCreation: 200, cacheRead: 2000 };
    const offline1 = turn(SESSION.basic, 'Lorem ipsum while offline one.', tokens);
    appendLines(scn.sessionFile(SESSION.basic), offline1.lines);

    const signal = await scn.agent(['sync-now']);
    expect(signal.code, signal.stderr).toBe(0);
    await waitFor('a sync attempt to hit the dead network', () =>
      scn.captures(SYNC_PATH).some((c) => c.fault === 'down'),
    );
    // Give the agent a moment to record the failure, then check nothing moved.
    await waitFor('the failure to be recorded', () => scn.kv('last_failure_at') !== null);
    expect(scn.checkpoints()).toEqual(committed);

    // More work while still offline, in a second session.
    const offline2 = turn(SESSION.splitUsage, 'Lorem ipsum while offline two.', tokens, {
      splitLines: 2,
    });
    appendLines(scn.sessionFile(SESSION.splitUsage), offline2.lines);
    expect(await scn.deviceCount('session_usage')).toBe(usageBefore);

    scn.proxy.setMode('pass');
    const again = await scn.agent(['sync-now']);
    expect(again.code, again.stderr).toBe(0);
    await waitFor(
      'the offline activity to arrive',
      async () => (await scn.deviceCount('session_usage')) === usageBefore + 2,
      { timeoutMs: 20_000 },
    );

    const ids = await scn.sql<{ source_message_id: string }>(
      'SELECT source_message_id FROM session_usage WHERE device_id = ? AND source_message_id IN (?, ?)',
      [await scn.deviceId(), offline1.messageId, offline2.messageId],
    );
    expect(ids.map((r) => r.source_message_id).sort()).toEqual(
      [offline1.messageId, offline2.messageId].sort(),
    );
    const totals = await scn.usageTotals();
    expect(totals.input).toBe(scn.expected.totals.input + 2 * tokens.input);
    expect(totals.cache_read).toBe(scn.expected.totals.cache_read + 2 * tokens.cacheRead);
    await waitFor('checkpoints to advance', () =>
      [...scn.checkpoints().values()].some(
        (c) =>
          c.path === scn.sessionFile(SESSION.splitUsage) &&
          c.offset > (committed.get(c.path)?.offset ?? Infinity),
      ),
    );
  });
});

import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { turn } from '../lib/lines.js';
import {
  appendLines,
  createScenario,
  payload,
  SESSION,
  SYNC_PATH,
  waitFor,
  type Daemon,
  type Scenario,
} from '../setup.js';

// `kill -9` while a sync is in flight: the backend has committed the batch, the agent never
// recorded the ack. After a restart it re-sends from its last committed position with a new
// batch_id (contract §8.2), and the upserts absorb the overlap: no loss, no duplicates.
describe('06 agent restart after kill -9 (AC14, AC16, contract §8.2)', () => {
  let scn: Scenario;
  let restarted: Daemon | undefined;

  beforeAll(async () => {
    scn = await createScenario('s06');
    await scn.pair();
  });
  afterAll(async () => {
    await restarted?.stop();
    await scn?.cleanup();
  });

  it('is killed mid-sync after the backend committed but before the agent saw the ack', async () => {
    scn.proxy.setMode('slow', { only: SYNC_PATH, delayMs: 10_000 });
    const daemon = await scn.startAgentDaemon();
    const inFlight = await waitFor('a sync to be in flight', () =>
      scn.captures(SYNC_PATH).find((c) => c.state === 'delaying'),
    );
    expect(inFlight.status).toBe(200);

    const killed = await daemon.kill();
    expect(killed.signal).toBe('SIGKILL');
    scn.proxy.setMode('pass');

    // Backend side: committed. Agent side: nothing committed, and the lock file is left behind.
    expect(await scn.deviceCount('session_usage')).toBe(scn.expected.usageIds.length);
    expect(scn.checkpoints().size).toBe(0);
    expect(existsSync(path.join(scn.dirs.dataDir, 'agent.lock'))).toBe(true);
  });

  it('restarts over the stale lock, re-sends with a new batch_id and stores no duplicates', async () => {
    const t = turn(SESSION.subagent, 'Lorem ipsum after the crash.', {
      input: 4,
      output: 40,
      cacheCreation: 400,
      cacheRead: 4000,
    });
    appendLines(scn.sessionFile(SESSION.subagent), t.lines);

    const killedBatch = payload(scn.captures(SYNC_PATH)[0]!).sync.batch_id;
    restarted = await scn.startAgentDaemon();
    const ack = await waitFor(
      'the re-sent batch to be acknowledged',
      () => scn.acknowledgedSyncs()[0],
      {
        timeoutMs: 20_000,
      },
    );
    expect(payload(ack).sync.batch_id).not.toBe(killedBatch);
    // It re-sent the already stored records too (upserted, not duplicated) plus the new one.
    const resent = payload(ack)
      .usage.map((u) => u.source_message_id)
      .sort();
    expect(resent).toEqual([...scn.expected.usageIds, t.messageId].sort());
    const counts = (ack.responseJson as { sync: { updated: number } }).sync;
    expect(counts.updated).toBeGreaterThan(0);

    const id = await scn.deviceId();
    expect(await scn.deviceCount('session_usage')).toBe(scn.expected.usageIds.length + 1);
    expect(await scn.deviceCount('claude_sessions')).toBe(scn.expected.sessions.length);
    expect(await scn.deviceCount('sync_batches')).toBe(2);
    const dupes = await scn.sql(
      'SELECT claude_session_id, source_message_id FROM session_usage WHERE device_id = ? GROUP BY 1, 2 HAVING COUNT(*) > 1',
      [id],
    );
    expect(dupes).toEqual([]);
    const totals = await scn.usageTotals();
    expect(totals.input).toBe(scn.expected.totals.input + 4);
    expect(totals.total).toBe(scn.expected.totals.total + 4 + 40 + 400 + 4000);
    await waitFor('checkpoints to be committed', () => scn.checkpoints().size > 0);
  });
});

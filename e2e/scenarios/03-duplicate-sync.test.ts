import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateSettings } from '../lib/backend.js';
import { turn } from '../lib/lines.js';
import {
  appendLines,
  createScenario,
  payload,
  SESSION,
  SYNC_PATH,
  waitFor,
  type Capture,
  type Scenario,
} from '../setup.js';

/**
 * Drops the next `/sync` answer (the backend commits, the agent never sees it), then asks the
 * running agent to retry at once instead of waiting out the 30 s backoff. Returns both requests.
 */
async function dropThenRetry(scn: Scenario): Promise<{ dropped: Capture; retried: Capture }> {
  const acked = scn.acknowledgedSyncs().length;
  const syncs = scn.captures(SYNC_PATH).length;
  scn.proxy.setMode('drop-response', { only: SYNC_PATH, times: 1 });
  const daemon = await scn.startAgentDaemon();
  const dropped = await waitFor('a sync answer to be dropped', () =>
    scn
      .captures(SYNC_PATH)
      .slice(syncs)
      .find((c) => c.fault === 'drop-response' && c.state === 'done'),
  );
  const signal = await scn.agent(['sync-now']);
  expect(signal.code, signal.stderr).toBe(0);
  const retried = await waitFor(
    'the retry to be acknowledged',
    () => scn.acknowledgedSyncs()[acked],
    {
      timeoutMs: 20_000,
    },
  );
  const stopped = await daemon.stop();
  expect(stopped.code, daemon.output()).toBe(0);
  return { dropped, retried };
}

// The backend commits a batch but the agent never sees the answer (the connection drops). The
// agent retries; the backend must not store anything twice (AC16). For a retry of the SAME batch
// (contract §8.2) the backend replays its stored response verbatim and writes nothing.
describe('03 duplicate sync (AC16, contract §8.2)', () => {
  let scn: Scenario;

  beforeAll(async () => {
    scn = await createScenario('s03');
  });
  afterAll(async () => {
    await scn?.cleanup();
  });

  describe('Account tracking OFF: the retry is the same batch and gets the stored response', () => {
    let dropped: Capture;
    let retried: Capture;

    beforeAll(async () => {
      await updateSettings(scn.ctx.backend, { account: false });
      await scn.pair();
      ({ dropped, retried } = await dropThenRetry(scn));
    });

    it('the backend committed the dropped batch, the agent committed nothing', async () => {
      expect(dropped.status).toBe(200);
      const [stored] = await scn.sql<{ status: string }>(
        'SELECT status FROM sync_batches WHERE device_id = ? AND batch_uuid = ?',
        [await scn.deviceId(), payload(dropped).sync.batch_id],
      );
      expect(stored?.status).toBe('succeeded');
      // The retry went out before any checkpoint moved: it re-sent the same position.
      expect(payload(retried).sync.cursor).toBeNull();
      expect(payload(retried).sync.sequence).toBe(payload(dropped).sync.sequence);
    });

    it('retries with the same batch_id and a byte-identical body', () => {
      expect(payload(retried).sync.batch_id).toBe(payload(dropped).sync.batch_id);
      expect(retried.requestBody).toBe(dropped.requestBody);
    });

    it('gets the stored response verbatim, equal to the answer it never received', async () => {
      const [stored] = await scn.sql<{ response: string }>(
        'SELECT response FROM sync_batches WHERE device_id = ? AND batch_uuid = ?',
        [await scn.deviceId(), payload(dropped).sync.batch_id],
      );
      expect(retried.responseJson).toEqual(JSON.parse(stored?.response ?? 'null'));
      expect(retried.responseJson).toEqual(dropped.responseJson);
    });

    it('stores no duplicate rows, one batch row, and counts the records once', async () => {
      expect(await scn.deviceCount('sync_batches')).toBe(1);
      expect(await scn.deviceCount('session_usage')).toBe(scn.expected.usageIds.length);
      expect(await scn.deviceCount('claude_sessions')).toBe(scn.expected.sessions.length);
      expect(await scn.usageTotals()).toEqual(scn.expected.totals);
      const [state] = await scn.sql<{ records_created_total: number }>(
        'SELECT records_created_total FROM agent_sync_states WHERE device_id = ?',
        [await scn.deviceId()],
      );
      const { created } = (retried.responseJson as { sync: { created: number } }).sync;
      expect(Number(state?.records_created_total)).toBe(created);
    });

    it('commits the checkpoints and cursor from the replayed ack', () => {
      expect(scn.checkpoints().size).toBeGreaterThan(0);
      expect(scn.kv('server_cursor')).toBe((retried.responseJson as { cursor: string }).cursor);
    });
  });

  describe('Account tracking ON (the default)', () => {
    let dropped: Capture;
    let retried: Capture;
    let usageBefore: number;
    let newMessageId: string;

    beforeAll(async () => {
      await updateSettings(scn.ctx.backend, { account: true });
      usageBefore = await scn.deviceCount('session_usage');
      const t = turn(SESSION.basic, 'Lorem ipsum before the dropped answer.', {
        input: 9,
        output: 90,
        cacheCreation: 900,
        cacheRead: 9000,
      });
      newMessageId = t.messageId;
      appendLines(scn.sessionFile(SESSION.basic), t.lines);
      ({ dropped, retried } = await dropThenRetry(scn));
    });

    it('the retry stores no duplicate rows', async () => {
      // The dropped batch was committed by the backend; the retry is the same batch and is
      // answered from the stored response, so no new batch row is written.
      expect(dropped.status).toBe(200);
      expect(await scn.deviceCount('sync_batches')).toBe(2);
      expect(payload(dropped).accounts).toHaveLength(1);
      expect(payload(retried).usage.map((u) => u.source_message_id)).toEqual(
        payload(dropped).usage.map((u) => u.source_message_id),
      );
      expect(await scn.deviceCount('session_usage')).toBe(usageBefore + 1);
      expect(await scn.deviceCount('claude_sessions')).toBe(scn.expected.sessions.length);
      const rows = await scn.sql(
        'SELECT id FROM session_usage WHERE device_id = ? AND source_message_id = ?',
        [await scn.deviceId(), newMessageId],
      );
      expect(rows).toHaveLength(1);
      expect(
        await scn.dbCount('claude_account_device', 'device_id = ?', [await scn.deviceId()]),
      ).toBe(1);
    });

    // Contract §8.2: a retry of the same chunk MUST reuse the batch_id with byte-identical
    // records. AccountRecord.observed_at is derived from the chunk's data, not the scan time
    // (F1 in e2e/README.md, fixed by H29), so the re-scan rebuilds the same batch.
    it('F1: the retry reuses the batch_id with byte-identical records', () => {
      expect(payload(retried).sync.batch_id).toBe(payload(dropped).sync.batch_id);
      expect(retried.requestBody).toBe(dropped.requestBody);
      expect(retried.responseJson).toEqual(dropped.responseJson);
    });
  });
});

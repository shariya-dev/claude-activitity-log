import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { turn } from '../lib/lines.js';
import {
  appendLines,
  createScenario,
  payload,
  SESSION,
  SYNC_PATH,
  type Scenario,
} from '../setup.js';

// A 500 from the backend must not move the agent's cursor; the next successful sync catches up.
describe('04 failed sync (AC17, PRD §30, §39)', () => {
  let scn: Scenario;

  beforeAll(async () => {
    scn = await createScenario('s04');
    await scn.pair();
  });
  afterAll(async () => {
    await scn?.cleanup();
  });

  it('a 500 on the initial sync leaves state.db without checkpoints or cursor', async () => {
    scn.proxy.setMode('500', { only: SYNC_PATH });
    const result = await scn.agent(['sync-now']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Sync failed.*persistence_failed/);
    expect(scn.captures(SYNC_PATH).every((c) => c.fault === '500')).toBe(true);

    expect(scn.checkpoints().size).toBe(0);
    expect(scn.kv('server_cursor')).toBeNull();
    expect(scn.kv('sync_sequence')).toBeNull();
    expect(scn.kv('last_error_code')).toBe('persistence_failed');
    expect(await scn.deviceCount('session_usage')).toBe(0);
  });

  it('catches up completely once the backend is healthy', async () => {
    scn.proxy.setMode('pass');
    const result = await scn.agent(['sync-now']);
    expect(result.code, result.stderr).toBe(0);
    expect(await scn.deviceCount('session_usage')).toBe(scn.expected.usageIds.length);
    expect(await scn.usageTotals()).toEqual(scn.expected.totals);
    expect(scn.checkpoints().size).toBeGreaterThan(0);
    expect(scn.kv('server_cursor')).toEqual(expect.any(String));
  });

  it('after a failure mid-life the checkpoints stay exactly where they were, then only new rows sync', async () => {
    const committed = scn.checkpoints();
    const cursor = scn.kv('server_cursor');
    const sequence = scn.kv('sync_sequence');
    const usageBefore = await scn.deviceCount('session_usage');

    const t = turn(SESSION.multiModel, 'Lorem ipsum after a failure.', {
      input: 3,
      output: 30,
      cacheCreation: 300,
      cacheRead: 3000,
    });
    appendLines(scn.sessionFile(SESSION.multiModel), t.lines);

    scn.proxy.setMode('500', { only: SYNC_PATH });
    const failed = await scn.agent(['sync-now']);
    expect(failed.code).toBe(1);
    expect(scn.checkpoints()).toEqual(committed);
    expect(scn.kv('server_cursor')).toBe(cursor);
    expect(scn.kv('sync_sequence')).toBe(sequence);
    expect(await scn.deviceCount('session_usage')).toBe(usageBefore);

    scn.proxy.setMode('pass');
    const syncsBefore = scn.captures(SYNC_PATH).length;
    const ok = await scn.agent(['sync-now']);
    expect(ok.code, ok.stderr).toBe(0);
    const resent = scn.captures(SYNC_PATH).slice(syncsBefore);
    expect(resent.flatMap((c) => payload(c).usage.map((u) => u.source_message_id))).toEqual([
      t.messageId,
    ]);
    expect(await scn.deviceCount('session_usage')).toBe(usageBefore + 1);
    expect(scn.checkpoints().get(scn.sessionFile(SESSION.multiModel))?.offset).toBeGreaterThan(
      committed.get(scn.sessionFile(SESSION.multiModel))?.offset ?? Infinity,
    );
    expect(scn.kv('sync_sequence')).toBe(Number(sequence) + 1);
  });
});

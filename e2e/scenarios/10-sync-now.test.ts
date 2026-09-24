import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deviceAction } from '../lib/backend.js';
import { turn } from '../lib/lines.js';
import {
  appendLines,
  createScenario,
  DEVICE_MORPH,
  HEARTBEAT_PATH,
  payload,
  SESSION,
  SYNC_PATH,
  waitFor,
  type Daemon,
  type Scenario,
} from '../setup.js';

// "Sync Now" on the dashboard sets a flag the next heartbeat returns once; the running agent then
// syncs at once. The sync interval is 3600 s here, so nothing but Sync Now can explain that sync.
// Heartbeats run every 60 s (the contract minimum), so this scenario waits up to one interval.
describe('10 dashboard Sync Now (PRD §51, contract §3.3)', () => {
  let scn: Scenario;
  let daemon: Daemon;

  beforeAll(async () => {
    scn = await createScenario('s10');
    await scn.pair();
    daemon = await scn.startAgentDaemon();
    await waitFor(
      'the startup heartbeat and sync',
      () => scn.captures(HEARTBEAT_PATH).length > 0 && scn.acknowledgedSyncs().length > 0,
    );
  });
  afterAll(async () => {
    await daemon?.stop();
    await scn?.cleanup();
  });

  it('the agent syncs on the heartbeat that follows the dashboard action', async () => {
    const t = turn(SESSION.basic, 'Lorem ipsum before Sync Now.', {
      input: 6,
      output: 60,
      cacheCreation: 600,
      cacheRead: 6000,
    });
    appendLines(scn.sessionFile(SESSION.basic), t.lines);
    const heartbeatsBefore = scn.captures(HEARTBEAT_PATH).length;
    const syncsBefore = scn.captures(SYNC_PATH).length;

    const id = await scn.deviceId();
    await deviceAction(scn.ctx.backend, 'RequestManualSync', id);
    expect((await scn.devices())[0]?.sync_requested_at).not.toBeNull();
    // Nothing happens before the next heartbeat.
    expect(scn.captures(SYNC_PATH)).toHaveLength(syncsBefore);

    const synced = await waitFor(
      'the heartbeat-triggered sync',
      () =>
        scn
          .acknowledgedSyncs()
          .find((c) => payload(c).usage.some((u) => u.source_message_id === t.messageId)),
      { timeoutMs: 90_000, intervalMs: 500 },
    );

    const heartbeats = scn.captures(HEARTBEAT_PATH).slice(heartbeatsBefore);
    const trigger = heartbeats.find(
      (c) => (c.responseJson as { sync_requested?: boolean }).sync_requested === true,
    );
    expect(trigger, 'a heartbeat answered sync_requested: true').toBeDefined();
    expect(synced.id).toBeGreaterThan(trigger!.id);
    // The flag is one-shot.
    expect((await scn.devices())[0]?.sync_requested_at).toBeNull();
    expect(await scn.deviceCount('session_usage')).toBe(scn.expected.usageIds.length + 1);
    expect(
      await scn.dbCount(
        'audit_logs',
        "action = 'sync.requested' AND subject_type = ? AND subject_id = ?",
        [DEVICE_MORPH, id],
      ),
    ).toBe(1);
  });
});

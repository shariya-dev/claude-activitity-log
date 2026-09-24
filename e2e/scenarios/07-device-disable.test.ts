import { statSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deviceAction } from '../lib/backend.js';
import { turn } from '../lib/lines.js';
import {
  appendLines,
  createScenario,
  DEVICE_MORPH,
  payload,
  SESSION,
  SYNC_PATH,
  type Scenario,
} from '../setup.js';

// An admin disables the device from the dashboard: the agent is refused and the device's history
// stays in the database. A re-pair code brings the same device row back.
describe('07 device disable (AC39, PRD §11, §35)', () => {
  let scn: Scenario;
  let deviceId: number;
  let deviceUid: string;
  let pending: ReturnType<typeof turn>;

  beforeAll(async () => {
    scn = await createScenario('s07');
    await scn.pair();
    const first = await scn.agent(['sync-now']);
    expect(first.code, first.stderr).toBe(0);
    deviceId = await scn.deviceId();
    deviceUid = String((await scn.devices())[0]?.device_uid);
  });
  afterAll(async () => {
    await scn?.cleanup();
  });

  it('the backend refuses the disabled device and stores nothing it sends', async () => {
    await deviceAction(scn.ctx.backend, 'DisableDevice', deviceId);
    pending = turn(SESSION.basic, 'Lorem ipsum while disabled.', {
      input: 1,
      output: 10,
      cacheCreation: 100,
      cacheRead: 1000,
    });
    appendLines(scn.sessionFile(SESSION.basic), pending.lines);

    const refused = await scn.agent(['sync-now']);
    expect(refused.code).toBe(1);
    // DisableDevice keeps the device token (H26), so `device.active` refuses with 403
    // `device_disabled` (contract §9.2), not a token-revoked 401.
    expect(scn.captures(SYNC_PATH).at(-1)?.status).toBe(403);
    expect(await scn.deviceCount('session_usage')).toBe(scn.expected.usageIds.length);
    // The agent keeps its position: the refused lines stay pending for after a re-pair.
    const basic = scn.sessionFile(SESSION.basic);
    expect(scn.checkpoints().get(basic)?.offset).toBeLessThan(statSync(basic).size);
  });

  // Contract §9.1/§9.2: the 403 carries the error envelope (`device_disabled`); the agent then
  // enters device_disabled, stops calling /sync and only probes by heartbeat (hourly).
  it('the refusal uses the contract envelope and the agent stops syncing', async () => {
    const denial = scn.captures(SYNC_PATH).at(-1);
    expect((denial?.responseJson as { error?: { code: string } } | null)?.error?.code).toBe(
      'device_disabled',
    );
    expect(scn.kv('agent_state')).toBe('device_disabled');
    const syncs = scn.captures(SYNC_PATH).length;
    await scn.agent(['sync-now']);
    expect(scn.captures(SYNC_PATH)).toHaveLength(syncs);
  });

  it('keeps the device and all of its history', async () => {
    const [device] = await scn.devices();
    expect(device).toMatchObject({ id: deviceId, status: 'disabled' });
    expect(device?.disabled_at).not.toBeNull();
    expect(await scn.deviceCount('claude_sessions')).toBe(scn.expected.sessions.length);
    expect(await scn.deviceCount('session_usage')).toBe(scn.expected.usageIds.length);
    expect(await scn.usageTotals()).toEqual(scn.expected.totals);
    // The token is kept so the agent hears 403 and an Enable resumes it without a re-pair.
    expect(
      await scn.dbCount('personal_access_tokens', 'tokenable_type = ? AND tokenable_id = ?', [
        DEVICE_MORPH,
        deviceId,
      ]),
    ).toBe(1);
    expect(
      await scn.dbCount(
        'audit_logs',
        "action = 'device.disabled' AND subject_type = ? AND subject_id = ?",
        [DEVICE_MORPH, deviceId],
      ),
    ).toBe(1);
  });

  it('a re-pair code reactivates the same device row, which then syncs without duplicates', async () => {
    const code = await scn.issueCode('repair');
    await scn.pair(code);
    const devices = await scn.devices();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ id: deviceId, device_uid: deviceUid, status: 'active' });

    const result = await scn.agent(['sync-now']);
    expect(result.code, result.stderr).toBe(0);
    const sent = scn.captures(SYNC_PATH).at(-1);
    expect(payload(sent!).usage.map((u) => u.source_message_id)).toContain(pending.messageId);
    expect(await scn.deviceCount('session_usage')).toBe(scn.expected.usageIds.length + 1);
    expect(await scn.deviceCount('claude_sessions')).toBe(scn.expected.sessions.length);
  });
});

import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateSettings } from '../lib/backend.js';
import {
  createScenario,
  DEVICE_MORPH,
  payload,
  REGISTER_PATH,
  SYNC_PATH,
  type Scenario,
} from '../setup.js';

interface RegisterBody {
  device: { machine_fingerprint: string };
}

// The same machine is reinstalled on a different network (another source IP in the forwarded
// headers, Network tracking ON) and pairs again. Identity is (developer, machine fingerprint)
// only, so it stays one device and one developer, and the full re-send creates no duplicates.
describe('09 network identity (AC13, PRD §26)', () => {
  let scn: Scenario;
  let first: Record<string, unknown> | undefined;

  beforeAll(async () => {
    scn = await createScenario('s09');
    await updateSettings(scn.ctx.backend, { network: true });
  });
  afterAll(async () => {
    await scn?.cleanup();
  });

  it('registers and syncs from the office network', async () => {
    scn.proxy.setHeaders({ 'x-forwarded-for': '203.0.113.10', 'x-real-ip': '203.0.113.10' });
    await scn.pair();
    const result = await scn.agent(['sync-now']);
    expect(result.code, result.stderr).toBe(0);
    [first] = await scn.devices();
    expect(await scn.deviceCount('session_usage')).toBe(scn.expected.usageIds.length);
  });

  it('re-registers from a different network as the same device', async () => {
    // Reinstall: the agent's local state and credentials are gone.
    rmSync(scn.dirs.dataDir, { recursive: true, force: true });
    scn.proxy.setHeaders({ 'x-forwarded-for': '198.51.100.77', 'x-real-ip': '198.51.100.77' });
    await scn.pair(await scn.issueCode());

    const registers = scn.captures(REGISTER_PATH);
    expect(registers).toHaveLength(2);
    expect(registers.map((c) => c.status)).toEqual([201, 201]);
    expect(registers[0]?.injectedHeaders['x-forwarded-for']).not.toBe(
      registers[1]?.injectedHeaders['x-forwarded-for'],
    );
    const [a, b] = registers.map((c) => (c.requestJson as RegisterBody).device.machine_fingerprint);
    expect(a).toBe(b);

    const devices = await scn.devices();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      id: first?.id,
      device_uid: first?.device_uid,
      first_seen_at: first?.first_seen_at,
      machine_fingerprint: a,
    });
    expect(await scn.dbCount('developers', 'email = ?', [scn.developer.email])).toBe(1);
    // The re-pair is audited with the request IP the backend saw. Without a trusted-proxy
    // configuration Laravel ignores X-Forwarded-For, so that is the proxy's 127.0.0.1: identity was
    // decided without any IP input, but the "different network" is only visible to the proxy
    // (README finding F4).
    const audits = await scn.sql<{ ip_address: string | null }>(
      "SELECT ip_address FROM audit_logs WHERE action = 'device.repaired' AND subject_type = ? AND subject_id = ?",
      [DEVICE_MORPH, first?.id],
    );
    expect(audits).toEqual([{ ip_address: '127.0.0.1' }]);
  });

  it('the full re-send from the new network creates no duplicates', async () => {
    const syncs = scn.captures(SYNC_PATH).length;
    const result = await scn.agent(['sync-now']);
    expect(result.code, result.stderr).toBe(0);
    const resent = scn.captures(SYNC_PATH).slice(syncs);
    expect(resent.flatMap((c) => payload(c).usage.map((u) => u.source_message_id)).sort()).toEqual(
      scn.expected.usageIds,
    );
    expect(await scn.deviceCount('claude_sessions')).toBe(scn.expected.sessions.length);
    expect(await scn.deviceCount('session_usage')).toBe(scn.expected.usageIds.length);
    expect(await scn.usageTotals()).toEqual(scn.expected.totals);
  });
});

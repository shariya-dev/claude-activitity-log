import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScenario, payload, SESSION, SYNC_PATH, waitFor, type Scenario } from '../setup.js';

// Pair with a one-time code, then the service entry point (`run`) discovers the Claude data on
// its own and performs the initial sync. The database must hold exactly the fixture contract.
describe('01 pair and initial sync (AC8, AC9, AC11, AC12, AC18–25)', () => {
  let scn: Scenario;

  beforeAll(async () => {
    scn = await createScenario('s01');
  });
  afterAll(async () => {
    await scn?.cleanup();
  });

  it('pairs non-interactively with the issued code', async () => {
    const result = await scn.pair();
    expect(result.stdout).toMatch(/^Paired as e2e-s01-/);
    const status = await scn.status();
    expect(status).toMatchObject({ paired: true, channel: 'dev' });
    expect(status.device_id).toMatch(/^dev_[0-9A-HJKMNP-TV-Z]{26}$/);
    const [device] = await scn.devices();
    expect(device).toMatchObject({ device_uid: status.device_id, status: 'active' });
  });

  it('the running agent detects the Claude data dir and syncs automatically', async () => {
    const daemon = await scn.startAgentDaemon();
    await waitFor(
      'the initial sync to be stored',
      async () => (await scn.deviceCount('session_usage')) === scn.expected.usageIds.length,
      { timeoutMs: 30_000 },
    );
    await waitFor('the sync acknowledgement', () => scn.acknowledgedSyncs().length > 0);
    const stopped = await daemon.stop();
    expect(stopped.code, daemon.output()).toBe(0);

    const status = await scn.status();
    expect(status.claude_data_dir).toBe(scn.dirs.claudeDir);
    expect(status.last_success_sync_at).not.toBeNull();
  });

  it('stores device information and platform (AC21)', async () => {
    const [device] = await scn.devices();
    expect(device).toMatchObject({
      platform: process.platform === 'darwin' ? 'macos' : 'linux',
      architecture: process.arch,
      agent_version: scn.ctx.agentVersion,
      claude_code_version: '2.1.274',
      status: 'active',
    });
    expect(device?.machine_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(device?.last_sync_at).not.toBeNull();
    expect(device?.hostname).not.toBeNull();
  });

  it('stores every session with its per-session token totals (AC18, AC23–25)', async () => {
    const rows = await scn.sql<{ source_session_id: string }>(
      'SELECT source_session_id FROM claude_sessions WHERE device_id = ? ORDER BY source_session_id',
      [await scn.deviceId()],
    );
    expect(rows.map((r) => r.source_session_id)).toEqual(scn.expected.sessions);

    const totals = await scn.sessionTotals();
    for (const [sid, expected] of Object.entries(scn.expected.perSession)) {
      expect(totals[sid], sid).toMatchObject(expected);
    }
  });

  it('stores one usage row per API message, deduplicated by message.id (AC11, AC24)', async () => {
    const rows = await scn.sql<{ source_message_id: string }>(
      'SELECT source_message_id FROM session_usage WHERE device_id = ? ORDER BY source_message_id',
      [await scn.deviceId()],
    );
    expect(rows.map((r) => r.source_message_id)).toEqual(scn.expected.usageIds);
    // Four raw columns stored separately; actual = input + output + cache_creation,
    // total = actual + cache_read, computed by the backend (TokenMath) only.
    expect(await scn.usageTotals()).toEqual(scn.expected.totals);
    const bad = await scn.sql(
      `SELECT id FROM session_usage WHERE device_id = ? AND (
         actual_consumed_tokens <> input_tokens + output_tokens + cache_creation_tokens OR
         total_token_activity <> actual_consumed_tokens + cache_read_tokens)`,
      [await scn.deviceId()],
    );
    expect(bad).toEqual([]);
  });

  it('the agent sends only raw token counts, never derived ones (AC25)', () => {
    for (const c of scn.captures(SYNC_PATH)) {
      expect(c.requestBody).not.toMatch(/actual_consumed|total_token_activity/);
    }
  });

  it('stores projects, models and the Claude account relationship (AC19, AC20, AC22)', async () => {
    const id = await scn.deviceId();
    const projects = await scn.sql<{ path: string }>(
      'SELECT path FROM project_locations WHERE device_id = ? ORDER BY path',
      [id],
    );
    expect(projects.map((p) => p.path)).toEqual(scn.expected.projectPaths);

    const models = await scn.sql<{ name: string }>(
      `SELECT DISTINCT m.name FROM session_usage u JOIN claude_models m ON m.id = u.claude_model_id
       WHERE u.device_id = ? ORDER BY m.name`,
      [id],
    );
    expect(models.map((m) => m.name)).toEqual(scn.expected.models);

    expect(await scn.dbCount('claude_account_device', 'device_id = ?', [id])).toBe(1);
    const sessionsWithAccount = await scn.dbCount(
      'claude_sessions',
      'device_id = ? AND claude_account_id IS NOT NULL',
      [id],
    );
    expect(sessionsWithAccount).toBe(scn.expected.sessions.length);
  });

  it('with prompt tracking OFF (the default) no prompt text is sent or stored (AC28, AC29)', async () => {
    expect(await scn.messageCount()).toBe(0);
    const bodies = scn.captures().map((c) => c.requestBody);
    for (const prompt of scn.expected.prompts) {
      for (const body of bodies) expect(body.includes(prompt)).toBe(false);
    }
    for (const c of scn.captures(SYNC_PATH)) expect(payload(c).messages).toEqual([]);
  });

  it('commits checkpoints only up to complete lines (the truncated last line stays pending)', () => {
    const { consumedBytes } = JSON.parse(
      readFileSync(path.join(scn.ctx.fixturesDir, 'expected', 'malformed.json'), 'utf8'),
    ) as { consumedBytes: number };
    const malformed = scn.checkpoints().get(scn.sessionFile(SESSION.malformed));
    expect(malformed?.offset).toBe(consumedBytes);
    expect(malformed?.size).toBeGreaterThan(consumedBytes);
    expect(scn.kv('initial_sync_done')).toBe(true);
    expect(scn.kv('server_cursor')).toEqual(expect.any(String));
  });
});

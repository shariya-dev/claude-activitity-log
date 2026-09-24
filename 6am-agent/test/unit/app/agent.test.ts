import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgent } from '../../../src/app/agent.js';
import { createContainer, type AgentContainer } from '../../../src/app/container.js';
import { clearPairing } from '../../../src/app/localState.js';
import { registerDevice } from '../../../src/app/pairing/pairingFlow.js';
import type { HeartbeatRequest } from '../../../src/core/contract/index.js';
import { makeEnv, VALID_CODE, waitFor, type TestEnv } from './helpers.js';

const TIMINGS = {
  pollMs: 10,
  discoveryRetryMs: 50,
  heartbeatMs: 20,
  pairingGraceMs: 0,
  stopTimeoutMs: 1_000,
};

describe('runAgent', () => {
  let env: TestEnv;
  let c: AgentContainer;
  let ac: AbortController;
  let run: Promise<void> | null;

  const start = () => {
    run = runAgent(c, { signal: ac.signal, timings: TIMINGS });
    return run;
  };

  const create = async () => {
    c = await createContainer({
      adapter: env.adapter,
      buildConfigPath: env.buildConfigPath,
      fetchImpl: env.backend.fetch,
    });
  };

  beforeEach(async () => {
    env = makeEnv();
    await create();
    ac = new AbortController();
    run = null;
  });

  afterEach(async () => {
    ac.abort();
    await run;
    c.close();
    env.cleanup();
  });

  it('unpaired ⇒ pairing mode: opens the loopback page and does not start the runtime', async () => {
    void start();
    await waitFor(() => env.adapter.openedUrls.length === 1);
    expect(env.adapter.openedUrls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/pair\//);
    expect(c.runtime.status().running).toBe(false);
    expect(env.backend.paths()).toEqual([]);

    ac.abort();
    await run;
    expect(existsSync(c.paths.pairingUrlFile)).toBe(false);
  });

  it('pairing through the page continues into the running runtime', async () => {
    void start();
    await waitFor(() => env.adapter.openedUrls.length === 1);
    const url = env.adapter.openedUrls[0] ?? '';
    await fetch(`${url}/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: VALID_CODE }),
    });
    await waitFor(() => c.runtime.status().running);
    await waitFor(() => env.backend.count('POST', '/heartbeat') >= 1);
    expect(env.backend.count('POST', '/register')).toBe(1);
  });

  it('paired ⇒ runtime started: heartbeat and sync reach the backend', async () => {
    await registerDevice(c, VALID_CODE);
    void start();
    await waitFor(() => c.runtime.status().running);
    await waitFor(() => env.backend.count('POST', '/sync') >= 1);
    expect(env.backend.count('POST', '/heartbeat')).toBeGreaterThanOrEqual(1);
    expect(env.adapter.openedUrls).toEqual([]);
    expect(c.source?.dataDir).toBe(env.claudeDir);

    ac.abort();
    await run;
    expect(c.runtime.status().running).toBe(false);
  });

  it('the sync-request file triggers runtime.requestSync and is consumed', async () => {
    await registerDevice(c, VALID_CODE);
    const requestSync = vi.spyOn(c.runtime, 'requestSync');
    void start();
    await waitFor(() => c.runtime.status().running);
    writeFileSync(c.paths.syncRequestFile, '');
    await waitFor(() => requestSync.mock.calls.length === 1);
    await waitFor(() => !existsSync(c.paths.syncRequestFile));
  });

  it('Claude data unavailable: heartbeats claude_data_unavailable and retries discovery', async () => {
    const hidden = `${env.claudeDir}-hidden`;
    renameSync(env.claudeDir, hidden);
    await registerDevice(c, VALID_CODE);
    void start();

    await waitFor(() => env.backend.count('POST', '/heartbeat') >= 1);
    const hb = env.backend.calls.find((x) => x.path === '/heartbeat')?.body as HeartbeatRequest;
    expect(hb.agent_state).toBe('claude_data_unavailable');
    expect(c.state.get('agent_state')).toBe('claude_data_unavailable');
    expect(c.runtime.status().running).toBe(false);
    expect(env.backend.count('POST', '/sync')).toBe(0);

    renameSync(hidden, env.claudeDir);
    await waitFor(() => c.runtime.status().running);
    expect(c.state.get('agent_state')).toBe('ok');
    await waitFor(() => env.backend.count('POST', '/sync') >= 1);
  });

  it('a repair while running reopens the pairing page', async () => {
    await registerDevice(c, VALID_CODE);
    void start();
    await waitFor(() => c.runtime.status().running);
    await clearPairing(c);
    await waitFor(() => env.adapter.openedUrls.length === 1);
    expect(c.runtime.status().running).toBe(true);
  });

  it('a 401 while running (needs_repair) reopens the pairing page', async () => {
    await registerDevice(c, VALID_CODE);
    env.backend.revoked = true;
    void start();
    await waitFor(() => c.runtime.status().running);
    await waitFor(() => c.state.get('agent_state') === 'needs_repair');
    expect(env.backend.count('POST', '/heartbeat')).toBe(1);
    await waitFor(() => env.adapter.openedUrls.length === 1);
  });
});

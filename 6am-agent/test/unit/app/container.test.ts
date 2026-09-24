import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContainer, type AgentContainer } from '../../../src/app/container.js';
import { makeEnv, type TestEnv } from './helpers.js';

describe('createContainer', () => {
  let env: TestEnv;
  let c: AgentContainer | null = null;

  beforeEach(() => {
    env = makeEnv();
  });

  afterEach(() => {
    c?.close();
    c = null;
    vi.unstubAllEnvs();
    env.cleanup();
  });

  const create = async () => {
    c = await createContainer({
      adapter: env.adapter,
      buildConfigPath: env.buildConfigPath,
      fetchImpl: env.backend.fetch,
    });
    return c;
  };

  it('wires state.db and logs into the adapter directories', async () => {
    const container = await create();
    expect(container.paths.stateDb).toBe(path.join(env.dataDir, 'state.db'));
    expect(existsSync(container.paths.stateDb)).toBe(true);
    expect(container.buildConfig).toEqual({
      apiBaseUrl: 'https://dev.monitor.test',
      channel: 'dev',
    });
    expect(container.source).toBeNull();
    expect(container.runtime.status().running).toBe(false);
  });

  it('sends API calls to <apiBaseUrl>/api/agent/v1 with the device token from the adapter', async () => {
    const container = await create();
    await env.adapter.credentials.set('device_token', 'tok-SECRET-9f8e7d6c5b4a');
    await container.api.settings();
    const call = env.backend.calls[0];
    expect(call?.path).toBe('/settings');
    expect(call?.headers.authorization).toBe('Bearer tok-SECRET-9f8e7d6c5b4a');
    expect(call?.headers['user-agent']).toMatch(/^6am-agent\/\S+ \(macos; \w+\)$/);
  });

  it('discovers the Claude data dir from the adapter candidates', async () => {
    const container = await create();
    const found = await container.discover();
    expect(found?.dataDir).toBe(env.claudeDir);
    expect(found?.globalConfigPath).toBe(path.join(env.claudeDir, '.claude.json'));
    expect(container.source).toEqual(found);
  });

  it('agentInfo carries the stored device_uid and the adapter device info', async () => {
    const container = await create();
    container.state.set('device_uid', 'dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W');
    await container.discover();
    const info = await container.agentInfo();
    expect(info).toMatchObject({
      device_id: 'dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W',
      platform: 'macos',
      hostname: 'fake-host',
      claude_code_version: '2.1.274',
    });
  });

  describe('dev-only overrides', () => {
    it('AGENT_DATA_DIR and AGENT_CREDENTIAL_BACKEND=file apply on the dev channel', async () => {
      const other = path.join(env.root, 'override');
      vi.stubEnv('AGENT_DATA_DIR', other);
      vi.stubEnv('AGENT_CREDENTIAL_BACKEND', 'file');
      vi.stubEnv('AGENT_API_BASE_URL', 'https://proxy.test:8766');
      const container = await create();
      expect(container.paths.appDataDir).toBe(other);
      expect(container.paths.logDir).toBe(path.join(other, 'logs'));
      expect(container.adapter.credentials.backend).toBe('file-0600');

      await container.adapter.credentials.set('device_token', 'tok-SECRET-9f8e7d6c5b4a');
      const file = path.join(other, 'credentials.json');
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(await container.adapter.credentials.get('device_token')).toBe(
        'tok-SECRET-9f8e7d6c5b4a',
      );

      await container.api.settings();
      expect(container.apiBaseUrl).toBe('https://proxy.test:8766');
      expect(env.backend.calls[0]?.path).toBe('/settings');
    });

    it('are ignored on the stable channel', async () => {
      env.cleanup();
      env = makeEnv({ channel: 'stable' });
      vi.stubEnv('AGENT_DATA_DIR', path.join(env.root, 'override'));
      vi.stubEnv('AGENT_CREDENTIAL_BACKEND', 'file');
      vi.stubEnv('AGENT_API_BASE_URL', 'https://evil.test');
      vi.stubEnv('AGENT_ADAPTER', 'fake');
      const container = await create();
      expect(container.paths.appDataDir).toBe(env.dataDir);
      expect(container.adapter).toBe(env.adapter);
      expect(container.adapter.credentials.backend).toBe('memory');
      expect(container.apiBaseUrl).toBe('https://monitor.test');
    });
  });
});

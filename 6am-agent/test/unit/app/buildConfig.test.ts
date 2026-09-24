import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyDevOverrides,
  loadBuildConfig,
  parseBuildConfig,
} from '../../../src/app/buildConfig.js';

describe('buildConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'h18-buildcfg-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses a stable config with an https base URL', () => {
    expect(
      parseBuildConfig({ apiBaseUrl: 'https://monitor.6amtech.com', channel: 'stable' }),
    ).toEqual({ apiBaseUrl: 'https://monitor.6amtech.com', channel: 'stable' });
  });

  it('rejects a stable config that is not https', () => {
    expect(() =>
      parseBuildConfig({ apiBaseUrl: 'http://127.0.0.1:8000', channel: 'stable' }),
    ).toThrow(/https/);
  });

  it('accepts http for a dev config and rejects unknown channels or bad URLs', () => {
    expect(parseBuildConfig({ apiBaseUrl: 'http://127.0.0.1:8000', channel: 'dev' }).channel).toBe(
      'dev',
    );
    expect(() => parseBuildConfig({ apiBaseUrl: 'https://x.test', channel: 'beta' })).toThrow();
    expect(() => parseBuildConfig({ apiBaseUrl: 'not a url', channel: 'dev' })).toThrow();
  });

  it('loads build-config.json from disk and names the path when it is missing', () => {
    const file = path.join(dir, 'build-config.json');
    writeFileSync(file, JSON.stringify({ apiBaseUrl: 'https://m.test', channel: 'stable' }));
    expect(loadBuildConfig(file)).toEqual({ apiBaseUrl: 'https://m.test', channel: 'stable' });
    expect(() => loadBuildConfig(path.join(dir, 'missing.json'))).toThrow(/missing\.json/);
  });

  it('the checked-in example is a valid dev config', () => {
    const example = loadBuildConfig(path.join(process.cwd(), 'build-config.example.json'));
    expect(example.channel).toBe('dev');
  });

  describe('applyDevOverrides', () => {
    const env = {
      AGENT_API_BASE_URL: 'http://127.0.0.1:8765',
      AGENT_DATA_DIR: '/tmp/agent-data',
      AGENT_CREDENTIAL_BACKEND: 'file',
      AGENT_ADAPTER: 'fake',
    };

    it('applies every override on the dev channel', () => {
      const r = applyDevOverrides({ apiBaseUrl: 'http://127.0.0.1:8000', channel: 'dev' }, env);
      expect(r).toEqual({
        apiBaseUrl: 'http://127.0.0.1:8765',
        dataDir: '/tmp/agent-data',
        fileCredentials: true,
        fakeAdapter: true,
      });
    });

    it('ignores every override on the stable channel', () => {
      const r = applyDevOverrides({ apiBaseUrl: 'https://m.test', channel: 'stable' }, env);
      expect(r).toEqual({
        apiBaseUrl: 'https://m.test',
        dataDir: null,
        fileCredentials: false,
        fakeAdapter: false,
      });
    });

    it('treats empty or unknown values as unset', () => {
      const r = applyDevOverrides(
        { apiBaseUrl: 'http://127.0.0.1:8000', channel: 'dev' },
        {
          AGENT_API_BASE_URL: '',
          AGENT_DATA_DIR: '',
          AGENT_CREDENTIAL_BACKEND: 'x',
          AGENT_ADAPTER: 'y',
        },
      );
      expect(r).toEqual({
        apiBaseUrl: 'http://127.0.0.1:8000',
        dataDir: null,
        fileCredentials: false,
        fakeAdapter: false,
      });
    });
  });
});

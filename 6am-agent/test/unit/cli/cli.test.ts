import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContainer, type AgentContainer } from '../../../src/app/container.js';
import { registerDevice } from '../../../src/app/pairing/pairingFlow.js';
import { runCli, type CliDeps } from '../../../src/cli/cli.js';
import {
  DEVICE_ID,
  makeEnv,
  SECRET_TOKEN,
  VALID_CODE,
  waitFor,
  type TestEnv,
} from '../app/helpers.js';

interface Captured {
  out: string;
  err: string;
}

describe('cli', () => {
  let env: TestEnv;
  let io: Captured;
  let open: AgentContainer[];

  const newContainer = async () => {
    const c = await createContainer({
      adapter: env.adapter,
      buildConfigPath: env.buildConfigPath,
      fetchImpl: env.backend.fetch,
    });
    open.push(c);
    return c;
  };

  const deps = (o: Partial<CliDeps> = {}): Partial<CliDeps> => ({
    createContainer: newContainer,
    stdout: (s) => (io.out += s),
    stderr: (s) => (io.err += s),
    entryPath: '/opt/6am-agent/app/agent.cjs',
    execPath: '/opt/6am-agent/runtime/node',
    runTimings: { pollMs: 10, pairingGraceMs: 0, stopTimeoutMs: 1_000 },
    ...o,
  });

  const cli = (argv: string[], o: Partial<CliDeps> = {}) => runCli(argv, deps(o));

  const pairDirectly = async () => {
    const c = await newContainer();
    await registerDevice(c, VALID_CODE);
    c.close();
  };

  beforeEach(() => {
    env = makeEnv();
    io = { out: '', err: '' };
    open = [];
  });

  afterEach(() => {
    for (const c of open) c.close();
    env.cleanup();
  });

  it('--version prints the agent version without building a container', async () => {
    const code = await runCli(['--version'], {
      stdout: (s) => (io.out += s),
      createContainer: () => Promise.reject(new Error('must not be called')),
    });
    expect(code).toBe(0);
    expect(io.out).toMatch(/^6am-agent \d+\.\d+\.\d+\S*\n$/);
  });

  it('ships as 1.0.0, the contract default min_agent_version, and the unbundled fallback matches package.json', async () => {
    const pkg = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '../../../package.json'), 'utf8'),
    ) as { version: string };
    expect(pkg.version).toBe('1.0.0');

    await runCli(['--version'], {
      stdout: (s) => (io.out += s),
      createContainer: () => Promise.reject(new Error('must not be called')),
    });
    expect(io.out).toBe(`6am-agent ${pkg.version}\n`);
  });

  it('an unknown command exits 2 with usage', async () => {
    expect(await cli(['frobnicate'])).toBe(2);
    expect(io.err).toMatch(/Usage/);
  });

  describe('run', () => {
    it('refuses a second instance while another live process holds the lock', async () => {
      mkdirSync(env.dataDir, { recursive: true });
      writeFileSync(path.join(env.dataDir, 'agent.lock'), `${process.ppid}\n`);
      expect(await cli(['run'])).toBe(1);
      expect(io.err).toMatch(/already running.*pid/i);
    });

    it('defaults to run, holds the lock while running and releases it on shutdown', async () => {
      await pairDirectly();
      const ac = new AbortController();
      const running = cli([], { signal: ac.signal });
      const lock = path.join(env.dataDir, 'agent.lock');
      await waitFor(() => existsSync(lock));
      await waitFor(() => env.backend.count('POST', '/sync') >= 1);
      ac.abort();
      expect(await running).toBe(0);
      expect(existsSync(lock)).toBe(false);
    });
  });

  describe('pair', () => {
    it('pair <code> registers non-interactively', async () => {
      expect(await cli(['pair', VALID_CODE])).toBe(0);
      expect(io.out).toContain('Paired as Dev Example');
      expect(await env.adapter.credentials.get('device_token')).toBe(SECRET_TOKEN);
      expect(env.adapter.openedUrls).toEqual([]);
      expect(io.out + io.err).not.toContain(SECRET_TOKEN);
    });

    it('pair <bad code> exits 1 with the generic message', async () => {
      expect(await cli(['pair', 'NOPE'])).toBe(1);
      expect(io.err).toContain('The pairing code is invalid or has expired.');
    });

    it('pair without a code opens the running agent pairing page when a service holds the lock', async () => {
      mkdirSync(env.dataDir, { recursive: true });
      writeFileSync(path.join(env.dataDir, 'agent.lock'), `${process.ppid}\n`);
      writeFileSync(path.join(env.dataDir, 'pairing-url'), 'http://127.0.0.1:5555/pair/abc\n');
      expect(await cli(['pair'])).toBe(0);
      expect(env.adapter.openedUrls).toEqual(['http://127.0.0.1:5555/pair/abc']);
    });

    it('pair without a code runs its own loopback page otherwise', async () => {
      const running = cli(['pair']);
      await waitFor(() => env.adapter.openedUrls.length === 1);
      const url = env.adapter.openedUrls[0] ?? '';
      await fetch(`${url}/code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: VALID_CODE }),
      });
      expect(await running).toBe(0);
      expect(io.out).toContain(url);
      expect(await env.adapter.credentials.get('device_token')).toBe(SECRET_TOKEN);
      expect(env.backend.count('POST', '/sync')).toBeGreaterThanOrEqual(1);
    });
  });

  describe('status', () => {
    it('--json reports pairing, device, backend host, Claude data dir and service status', async () => {
      await pairDirectly();
      expect(await cli(['status', '--json'])).toBe(0);
      const s = JSON.parse(io.out) as Record<string, unknown>;
      expect(s).toMatchObject({
        paired: true,
        device_id: DEVICE_ID,
        backend_host: 'dev.monitor.test',
        claude_data_dir: env.claudeDir,
        settings_version: 1,
        service: 'not-installed',
        running_pid: null,
      });
      expect(s).toHaveProperty('agent_state');
      expect(s).toHaveProperty('last_success_sync_at');
      expect(s).toHaveProperty('last_failure_at');
    });

    it('prints a readable summary for an unpaired device', async () => {
      expect(await cli(['status'])).toBe(0);
      expect(io.out).toMatch(/Paired:\s+no/);
      expect(io.out).toMatch(/Backend:\s+dev\.monitor\.test/);
    });
  });

  describe('sync-now', () => {
    it('signals a running agent through the sync-request file', async () => {
      await pairDirectly();
      writeFileSync(path.join(env.dataDir, 'agent.lock'), `${process.ppid}\n`);
      expect(await cli(['sync-now'])).toBe(0);
      expect(existsSync(path.join(env.dataDir, 'sync-request'))).toBe(true);
      expect(env.backend.count('POST', '/sync')).toBe(0);
    });

    it('runs one sync in-process when no agent is running', async () => {
      await pairDirectly();
      expect(await cli(['sync-now'])).toBe(0);
      expect(env.backend.count('POST', '/sync')).toBe(1);
      expect(io.out).toMatch(/Sync ok/);
      expect(existsSync(path.join(env.dataDir, 'agent.lock'))).toBe(false);
    });

    it('fails when the device is not paired', async () => {
      expect(await cli(['sync-now'])).toBe(1);
      expect(io.err).toMatch(/not paired/i);
    });
  });

  describe('diagnostics', () => {
    it('--json contains no token values, even when the log does', async () => {
      await pairDirectly();
      const log = path.join(env.dataDir, 'logs', 'agent.log');
      mkdirSync(path.dirname(log), { recursive: true });
      appendFileSync(
        log,
        [
          JSON.stringify({ ts: 't', level: 'info', msg: 'ok', device_token: SECRET_TOKEN }),
          JSON.stringify({ ts: 't', level: 'warn', msg: `Bearer ${SECRET_TOKEN}` }),
          JSON.stringify({ ts: 't', level: 'warn', msg: 'x', detail: `raw ${SECRET_TOKEN}` }),
          `garbage ${SECRET_TOKEN}`,
          '',
        ].join('\n'),
      );
      expect(await cli(['diagnostics', '--json'])).toBe(0);
      expect(io.out).not.toContain(SECRET_TOKEN);
      const d = JSON.parse(io.out) as Record<string, unknown>;

      const tokenValues: unknown[] = [];
      JSON.stringify(d, (k, v: unknown) => {
        if (/token/i.test(k) && typeof v === 'string' && v !== '[redacted]') tokenValues.push(v);
        return v;
      });
      expect(tokenValues).toEqual([]);

      expect(d).toMatchObject({
        status: { paired: true, device_id: DEVICE_ID },
        credential_backend: 'memory',
      });
      expect(d.discovery).toMatchObject({
        candidates: [{ path: env.claudeDir, readable: true }],
      });
      const tail = d.log_tail as unknown[];
      expect(tail).toContain('[unparseable log line]');
      expect(tail).toContainEqual({
        ts: 't',
        level: 'info',
        msg: 'ok',
        device_token: '[redacted]',
      });
      expect(tail).toContainEqual({ ts: 't', level: 'warn', msg: 'Bearer [redacted]' });
      expect(d.versions).toMatchObject({ node: process.versions.node, claude_code: '2.1.274' });
    });
  });

  describe('repair', () => {
    it('clears the pairing and tells a running agent to show the pairing page', async () => {
      await pairDirectly();
      writeFileSync(path.join(env.dataDir, 'agent.lock'), `${process.ppid}\n`);
      expect(await cli(['repair'])).toBe(0);
      expect(await env.adapter.credentials.get('device_token')).toBeNull();
      expect(io.out).toMatch(/running agent/i);
      expect(env.adapter.openedUrls).toEqual([]);
    });

    it('opens its own pairing page when no agent runs', async () => {
      await pairDirectly();
      const ac = new AbortController();
      const running = cli(['repair'], { signal: ac.signal });
      await waitFor(() => env.adapter.openedUrls.length === 1);
      expect(await env.adapter.credentials.get('device_token')).toBeNull();
      ac.abort();
      expect(await running).toBe(1);
    });
  });

  describe('service', () => {
    it('install-service passes the runtime and bundle paths to the adapter', async () => {
      expect(await cli(['install-service'])).toBe(0);
      expect(env.adapter.service.installs).toEqual([
        { nodePath: '/opt/6am-agent/runtime/node', entryPath: '/opt/6am-agent/app/agent.cjs' },
      ]);
    });

    it('uninstall-service uninstalls and deregisters best-effort', async () => {
      await pairDirectly();
      expect(await cli(['uninstall-service'])).toBe(0);
      expect(env.adapter.service.uninstalls).toBe(1);
      expect(env.backend.count('POST', '/deregister')).toBe(1);
    });

    it('uninstall-service still succeeds when deregister fails', async () => {
      await pairDirectly();
      env.backend.revoked = true;
      const failing: typeof fetch = () => Promise.reject(new Error('offline'));
      const c = await createContainer({
        adapter: env.adapter,
        buildConfigPath: env.buildConfigPath,
        fetchImpl: failing,
      });
      open.push(c);
      expect(await cli(['uninstall-service'], { createContainer: () => Promise.resolve(c) })).toBe(
        0,
      );
      expect(env.adapter.service.uninstalls).toBe(1);
    });
  });
});

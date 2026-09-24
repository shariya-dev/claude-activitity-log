import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContainer, type AgentContainer } from '../../../src/app/container.js';
import { clearPairing, isPaired } from '../../../src/app/localState.js';
import {
  PairingError,
  registerDevice,
  runPairingSession,
} from '../../../src/app/pairing/pairingFlow.js';
import type { RegisterRequest } from '../../../src/core/contract/index.js';
import { DEVICE_ID, makeEnv, SECRET_TOKEN, VALID_CODE, waitFor, type TestEnv } from './helpers.js';

/** Every byte SQLite wrote for state.db (main file + WAL), as latin1 text. */
function stateBytes(dataDir: string): string {
  return readdirSync(dataDir)
    .filter((f) => f.startsWith('state.db'))
    .map((f) => readFileSync(path.join(dataDir, f)).toString('latin1'))
    .join('');
}

async function submit(url: string, code: string): Promise<Response> {
  return fetch(`${url}/code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

describe('pairing flow', () => {
  let env: TestEnv;
  let c: AgentContainer;

  beforeEach(async () => {
    env = makeEnv();
    c = await createContainer({
      adapter: env.adapter,
      buildConfigPath: env.buildConfigPath,
      fetchImpl: env.backend.fetch,
    });
  });

  afterEach(() => {
    c.close();
    env.cleanup();
  });

  describe('registerDevice', () => {
    it('stores the token via the adapter credentials only, never in SQLite', async () => {
      expect(await isPaired(c)).toBe(false);
      const result = await registerDevice(c, VALID_CODE);
      expect(result.developer).toBe('Dev Example');

      expect(await env.adapter.credentials.get('device_token')).toBe(SECRET_TOKEN);
      expect(c.state.get('device_uid')).toBe(DEVICE_ID);
      expect(c.state.get('settings')?.version).toBe(1);
      expect(c.state.get('agent_state')).toBe('ok');
      expect(await isPaired(c)).toBe(true);

      c.close();
      expect(stateBytes(env.dataDir)).not.toContain(SECRET_TOKEN);
      expect(readdirSync(env.dataDir).join(' ')).not.toMatch(/credential/);
    });

    it('sends the adapter device info and versions', async () => {
      await registerDevice(c, ` ${VALID_CODE} `);
      const req = env.backend.calls.find((x) => x.path === '/register')?.body as RegisterRequest;
      expect(req.pairing_code).toBe(VALID_CODE);
      expect(req.device).toMatchObject({
        hostname: 'fake-host',
        platform: 'macos',
        platform_version: '1.0.0',
        architecture: 'arm64',
        claude_code_version: '2.1.274',
      });
      expect(req.device.machine_fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(req.device.agent_version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('resumes sync_sequence from GET /sync/status when none is stored', async () => {
      env.backend.serverSequence = 41;
      await registerDevice(c, VALID_CODE);
      expect(c.state.get('sync_sequence')).toBe(41);

      env.backend.serverSequence = 99;
      await registerDevice(c, VALID_CODE);
      expect(c.state.get('sync_sequence')).toBe(41);
    });

    it('a rejected code stores nothing and gives the generic message', async () => {
      const err = await registerDevice(c, 'WRONG').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PairingError);
      expect((err as PairingError).message).toBe('The pairing code is invalid or has expired.');
      expect(await env.adapter.credentials.get('device_token')).toBeNull();
      expect(c.state.get('device_uid')).toBeNull();
    });

    it('re-pairing to a different device id resets checkpoints and the cursor', async () => {
      c.state.commitBatch(
        [{ path: '/x.jsonl', fileIdentity: '1:2', size: 10, mtimeMs: 1, offset: 10 }],
        {
          device_uid: 'dev_01OLDOLDOLDOLDOLDOLDOLDOLD',
          server_cursor: 'c-1',
          initial_sync_done: true,
        },
      );
      await registerDevice(c, VALID_CODE);
      expect(c.state.checkpoints().size).toBe(0);
      expect(c.state.get('server_cursor')).toBeNull();
      expect(c.state.get('initial_sync_done')).toBeNull();
    });

    it('re-pairing to the same device id keeps checkpoints', async () => {
      c.state.commitBatch(
        [{ path: '/x.jsonl', fileIdentity: '1:2', size: 10, mtimeMs: 1, offset: 10 }],
        { device_uid: DEVICE_ID, server_cursor: 'c-1', agent_state: 'needs_repair' },
      );
      await registerDevice(c, VALID_CODE);
      expect(c.state.checkpoints().size).toBe(1);
      expect(c.state.get('server_cursor')).toBe('c-1');
      expect(c.state.get('agent_state')).toBe('ok');
    });
  });

  describe('clearPairing (repair)', () => {
    it('clears credentials, device_uid and checkpoints and marks needs_repair', async () => {
      await registerDevice(c, VALID_CODE);
      c.state.commitBatch(
        [{ path: '/x.jsonl', fileIdentity: '1:2', size: 10, mtimeMs: 1, offset: 10 }],
        { server_cursor: 'c-1' },
      );
      await clearPairing(c);
      expect(await env.adapter.credentials.get('device_token')).toBeNull();
      expect(c.state.get('device_uid')).toBeNull();
      expect(c.state.checkpoints().size).toBe(0);
      expect(c.state.get('server_cursor')).toBeNull();
      expect(await isPaired(c)).toBe(false);
    });
  });

  describe('runPairingSession', () => {
    it('opens the loopback page, pairs, detects Claude data and runs the initial sync', async () => {
      const session = runPairingSession(c, { openBrowser: true, pollMs: 20, graceMs: 0 });
      await waitFor(() => env.adapter.openedUrls.length === 1);
      const url = env.adapter.openedUrls[0] ?? '';
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/pair\//);
      expect(readFileSync(c.paths.pairingUrlFile, 'utf8').trim()).toBe(url);

      expect((await submit(url, VALID_CODE)).status).toBe(202);
      await expect(session).resolves.toBe('paired');

      expect(await env.adapter.credentials.get('device_token')).toBe(SECRET_TOKEN);
      expect(env.backend.count('POST', '/sync')).toBeGreaterThanOrEqual(1);
      expect(c.counters).toEqual({ sessions: 1, usage: 3 });
      expect(c.source?.dataDir).toBe(env.claudeDir);
      expect(existsSync(c.paths.pairingUrlFile)).toBe(false);
      await expect(fetch(url)).rejects.toThrow();
    });

    it('shows the generic error for a bad code and accepts a retry', async () => {
      let url = '';
      const session = runPairingSession(c, {
        openBrowser: false,
        pollMs: 20,
        graceMs: 0,
        onUrl: (u) => (url = u),
      });
      await waitFor(() => url !== '');
      await submit(url, 'WRONG');
      await waitFor(async () => {
        const s = (await (await fetch(`${url}/status`)).json()) as { phase: string };
        return s.phase === 'error';
      });
      const s = (await (await fetch(`${url}/status`)).json()) as { message: string };
      expect(s.message).toBe('The pairing code is invalid or has expired.');
      expect(env.adapter.openedUrls).toEqual([]);

      await submit(url, VALID_CODE);
      await expect(session).resolves.toBe('paired');
    });

    it('finishes without a sync when no Claude data exists yet', async () => {
      rmSync(env.claudeDir, { recursive: true, force: true });
      let url = '';
      const session = runPairingSession(c, {
        openBrowser: false,
        pollMs: 20,
        graceMs: 0,
        onUrl: (u) => (url = u),
      });
      await waitFor(() => url !== '');
      await submit(url, VALID_CODE);
      await expect(session).resolves.toBe('paired');
      expect(env.backend.count('POST', '/sync')).toBe(0);
      expect(c.source).toBeNull();
    });

    it('ends when another process pairs the device (pair <code>)', async () => {
      const session = runPairingSession(c, { openBrowser: false, pollMs: 20, graceMs: 0 });
      await waitFor(() => existsSync(c.paths.pairingUrlFile));
      await registerDevice(c, VALID_CODE);
      await expect(session).resolves.toBe('paired');
      expect(env.backend.count('POST', '/sync')).toBe(0);
    });

    it('resolves aborted when the signal fires', async () => {
      const ac = new AbortController();
      const session = runPairingSession(c, { openBrowser: false, pollMs: 20, signal: ac.signal });
      await waitFor(() => existsSync(c.paths.pairingUrlFile));
      ac.abort();
      await expect(session).resolves.toBe('aborted');
      expect(existsSync(c.paths.pairingUrlFile)).toBe(false);
    });
  });
});

import { rmSync, writeFileSync } from 'node:fs';
import { AGENT_VERSION } from '../../cli/version.js';
import { ApiError } from '../../core/sync/apiClient.js';
import { DEVICE_TOKEN_KEY, type AgentContainer } from '../container.js';
import { isPaired, resetSyncPosition } from '../localState.js';
import { settleWithin, sleep } from '../timers.js';
import { startPairingServer, type PairingProgress } from './localPairingServer.js';

/** A pairing failure with a message that is safe to show (never server text, never a token). */
export class PairingError extends Error {
  override readonly name = 'PairingError';
}

const GENERIC_CODE_MESSAGE = 'The pairing code is invalid or has expired.';

function pairingErrorFor(err: unknown): PairingError {
  if (!(err instanceof ApiError)) {
    return new PairingError('Pairing failed. See the agent log for details.');
  }
  switch (err.code) {
    case 'invalid_pairing_code':
      return new PairingError(GENERIC_CODE_MESSAGE);
    case 'rate_limited':
      return new PairingError('Too many pairing attempts. Wait a minute and try again.');
    case 'network':
    case 'timeout':
      return new PairingError(
        'Could not reach the monitoring server. Check your connection and try again.',
      );
    default:
      return new PairingError(`Pairing failed (${err.code}). Contact your administrator.`);
  }
}

/**
 * `POST /register` with the adapter's device info. On success the token goes only to
 * `adapter.credentials`; SQLite gets the device id and settings. Throws PairingError.
 */
export async function registerDevice(
  c: AgentContainer,
  code: string,
): Promise<{ developer: string }> {
  let resp;
  try {
    const info = await c.deviceInfo();
    if (c.source === null) await c.discover();
    const agent = await c.agentInfo();
    resp = await c.api.register({
      pairing_code: code.trim(),
      device: {
        hostname: agent.hostname,
        platform: c.adapter.id,
        platform_version: agent.platform_version,
        architecture: info.architecture,
        machine_fingerprint: info.machineFingerprint,
        agent_version: AGENT_VERSION,
        claude_code_version: agent.claude_code_version,
      },
    });
  } catch (err) {
    const pairingError = pairingErrorFor(err);
    c.logger.warn('pairing_failed', {
      code: err instanceof ApiError ? err.code : 'internal_error',
    });
    throw pairingError;
  }

  await c.adapter.credentials.set(DEVICE_TOKEN_KEY, resp.token);
  const previous = c.state.get('device_uid');
  if (previous !== null && previous !== '' && previous !== resp.device_id) {
    resetSyncPosition(c.state);
  }
  c.state.commitBatch([], {
    device_uid: resp.device_id,
    settings: resp.settings,
    settings_version: resp.settings.version,
    last_settings_sync_at: new Date().toISOString(),
    agent_state: 'ok',
  });
  c.logger.info('device_paired', { device_id: resp.device_id });
  return { developer: resp.developer.name };
}

const PROGRESS_MS = 500;
const SHUTDOWN_WAIT_MS = 10_000;

/**
 * Pairing mode: the loopback page (opened in the browser unless `openBrowser` is false), then
 * detection and the initial sync with live progress. Also ends when another process pairs the
 * device (`pair <code>`). Writes the page URL to `<app_data_dir>/pairing-url` while it runs so
 * `pair` can reopen it.
 */
export async function runPairingSession(
  c: AgentContainer,
  o: {
    signal?: AbortSignal;
    openBrowser?: boolean;
    pollMs?: number;
    graceMs?: number;
    onUrl?: (url: string) => void;
  } = {},
): Promise<'paired' | 'aborted'> {
  const pollMs = o.pollMs ?? 2_000;
  const graceMs = o.graceMs ?? 5_000;
  const pending: { flow: Promise<void> | null } = { flow: null };

  const pairAndSync = async (code: string): Promise<void> => {
    let developer: string;
    try {
      ({ developer } = await registerDevice(c, code));
    } catch (err) {
      server.setProgress({
        phase: 'error',
        message: err instanceof PairingError ? err.message : 'Pairing failed.',
      });
      return;
    }
    server.setProgress({ phase: 'detecting', developer });
    const found = await c.discover();
    if (found === null) {
      server.setProgress({ phase: 'done', developer, claudeFound: false, sessions: 0, usage: 0 });
      return;
    }
    c.counters.sessions = 0;
    c.counters.usage = 0;
    const progress = (): PairingProgress => ({
      phase: 'syncing',
      developer,
      sessions: c.counters.sessions,
      usage: c.counters.usage,
    });
    server.setProgress(progress());
    const ticker = setInterval(() => server.setProgress(progress()), PROGRESS_MS);
    try {
      await c.syncOnce();
    } finally {
      clearInterval(ticker);
    }
    server.setProgress({
      phase: 'done',
      developer,
      claudeFound: true,
      sessions: c.counters.sessions,
      usage: c.counters.usage,
    });
  };

  const server = await startPairingServer({
    onCode: (code) => {
      pending.flow = pairAndSync(code).catch((err: unknown) => {
        c.logger.error('pairing_flow_failed', { error: err instanceof Error ? err.name : 'error' });
        server.setProgress({ phase: 'error', message: 'Pairing failed.' });
      });
    },
  });
  writeFileSync(c.paths.pairingUrlFile, `${server.url}\n`, { mode: 0o600 });
  c.logger.info('pairing_mode_started', { port: server.port });
  o.onUrl?.(server.url);
  if (o.openBrowser !== false) {
    await c.adapter.openUrl(server.url).catch(() => {
      c.logger.warn('open_browser_failed');
    });
  }

  let result: 'paired' | 'aborted' = 'aborted';
  try {
    while (o.signal?.aborted !== true) {
      const phase = server.progress().phase;
      if (phase === 'done') {
        result = 'paired';
        await sleep(graceMs, o.signal);
        break;
      }
      if ((phase === 'waiting' || phase === 'error') && (await isPaired(c))) {
        result = 'paired';
        break;
      }
      await sleep(pollMs, o.signal);
    }
  } finally {
    // Shutdown mid-registration: let the in-flight request finish (bounded) before closing.
    if (pending.flow !== null && result === 'aborted') {
      await settleWithin(pending.flow, SHUTDOWN_WAIT_MS);
    }
    rmSync(c.paths.pairingUrlFile, { force: true });
    await server.close();
  }
  return result;
}

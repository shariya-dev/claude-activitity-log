import { existsSync, rmSync } from 'node:fs';
import type { HeartbeatRequest } from '../core/contract/index.js';
import type { StateStore } from '../core/state/stateStore.js';
import { ApiError } from '../core/sync/apiClient.js';
import { applyApiErrorState } from '../core/sync/errorPolicy.js';
import type { AgentContainer } from './container.js';
import { isPaired } from './localState.js';
import { runPairingSession } from './pairing/pairingFlow.js';
import { settleWithin, sleep } from './timers.js';

export interface RunTimings {
  /** Local checks: sync-request file, lost pairing, pairing-page progress. */
  pollMs: number;
  /** Claude data re-discovery while it is unavailable (architecture §3: every 10 min). */
  discoveryRetryMs: number;
  /** Heartbeat interval while Claude data is unavailable; null = from settings. */
  heartbeatMs: number | null;
  pairingGraceMs: number;
  /** Graceful shutdown: the current HTTP request may finish within this. */
  stopTimeoutMs: number;
}

const DEFAULT_TIMINGS: RunTimings = {
  pollMs: 2_000,
  discoveryRetryMs: 10 * 60_000,
  heartbeatMs: null,
  pairingGraceMs: 5_000,
  stopTimeoutMs: 10_000,
};

const DEFAULT_HEARTBEAT_SECONDS = 300;
const DISABLED_HEARTBEAT_SECONDS = 3_600;

/** Cheap check (no credential store access) for a pairing lost by `repair` or a 401. */
function pairingLost(state: StateStore): boolean {
  const uid = state.get('device_uid');
  return uid === null || uid === '' || state.get('agent_state') === 'needs_repair';
}

function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof ApiError) return { error: err.name, code: err.code, status: err.status };
  return { error: err instanceof Error ? err.name : typeof err };
}

/** A heartbeat that reports `claude_data_unavailable` while the runtime is not started yet. */
async function unavailableHeartbeat(c: AgentContainer): Promise<void> {
  const settings = c.state.get('settings');
  const info = await c.agentInfo();
  const req: HeartbeatRequest = {
    agent_version: info.agent_version,
    claude_code_version: null,
    platform_version: info.platform_version,
    hostname: settings?.categories.device === true ? info.hostname : null,
    agent_state: 'claude_data_unavailable',
    last_local_activity_at: null,
    last_successful_sync_at: c.state.get('last_success_sync_at'),
    last_error: null,
  };
  try {
    const resp = await c.api.heartbeat(req);
    if (c.state.get('agent_state') !== 'claude_data_unavailable') {
      c.state.set('agent_state', 'claude_data_unavailable');
    }
    const version = Math.max(resp.settings_version, c.api.lastSettingsVersion() ?? 0);
    await c.settings.refreshIfNeeded(version).catch((err: unknown) => {
      c.logger.warn('settings_refresh_failed', describeError(err));
    });
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    applyApiErrorState(c.state, err, new Date());
    c.logger.warn('heartbeat_failed', { code: err.code, status: err.status });
  }
}

/**
 * Discovers Claude data; while it is unavailable, re-discovers every `discoveryRetryMs` and keeps
 * heartbeating `claude_data_unavailable` (architecture §3). Returns once found, when the pairing
 * is lost, or on abort.
 */
async function waitForClaudeData(
  c: AgentContainer,
  signal: AbortSignal,
  t: RunTimings,
): Promise<'found' | 'unpaired' | 'aborted'> {
  const found = async (): Promise<boolean> => {
    if ((await c.discover()) === null) return false;
    if (c.state.get('agent_state') === 'claude_data_unavailable') c.state.set('agent_state', 'ok');
    return true;
  };
  if (await found()) return 'found';

  c.state.set('agent_state', 'claude_data_unavailable');
  c.logger.warn('claude_data_unavailable', { candidates: c.adapter.claudeDataCandidates().length });
  const heartbeatMs = (): number => {
    if (t.heartbeatMs !== null) return t.heartbeatMs;
    if (c.state.get('agent_state') === 'device_disabled') return DISABLED_HEARTBEAT_SECONDS * 1_000;
    const seconds = c.state.get('settings')?.heartbeat_interval_seconds;
    return (seconds ?? DEFAULT_HEARTBEAT_SECONDS) * 1_000;
  };
  let nextHeartbeat = 0;
  let nextDiscovery = Date.now() + t.discoveryRetryMs;

  while (!signal.aborted) {
    if (pairingLost(c.state)) return 'unpaired';
    const now = Date.now();
    if (now >= nextHeartbeat) {
      try {
        await unavailableHeartbeat(c);
      } catch (err) {
        c.logger.error('heartbeat_failed', describeError(err));
      }
      nextHeartbeat = Date.now() + heartbeatMs();
      if (pairingLost(c.state)) return 'unpaired';
    }
    if (now >= nextDiscovery) {
      if (await found()) return 'found';
      nextDiscovery = Date.now() + t.discoveryRetryMs;
    }
    await sleep(t.pollMs, signal);
  }
  return 'aborted';
}

/** While running: `sync-now` touches the sync-request file; a lost pairing ends the watch. */
async function watch(
  c: AgentContainer,
  signal: AbortSignal,
  t: RunTimings,
): Promise<'unpaired' | 'aborted'> {
  while (!signal.aborted) {
    if (existsSync(c.paths.syncRequestFile)) {
      rmSync(c.paths.syncRequestFile, { force: true });
      c.logger.info('sync_requested_locally');
      c.runtime.requestSync();
    }
    if (pairingLost(c.state)) return 'unpaired';
    await sleep(t.pollMs, signal);
  }
  return 'aborted';
}

/**
 * The `run` command (what the service launches), after the single-instance lock is held:
 * pairing mode while unpaired, then Claude data discovery, then the H10 runtime. A lost pairing
 * (repair, 401) reopens pairing mode; the runtime keeps idling in `needs_repair` meanwhile and
 * resumes once re-paired. Resolves after `signal` aborts and the runtime stopped (bounded).
 */
export async function runAgent(
  c: AgentContainer,
  o: { signal: AbortSignal; openBrowser?: boolean; timings?: Partial<RunTimings> },
): Promise<void> {
  const t: RunTimings = { ...DEFAULT_TIMINGS, ...o.timings };
  const { signal } = o;
  let started = false;
  c.logger.info('agent_started', { channel: c.buildConfig.channel });

  try {
    while (!signal.aborted) {
      if (!(await isPaired(c))) {
        const paired = await runPairingSession(c, {
          signal,
          openBrowser: o.openBrowser !== false,
          pollMs: t.pollMs,
          graceMs: t.pairingGraceMs,
        });
        if (paired === 'aborted') break;
        continue;
      }
      if (!started) {
        const data = await waitForClaudeData(c, signal, t);
        if (data !== 'found') continue;
        started = true;
        void c.runtime.start();
      }
      await watch(c, signal, t);
    }
  } finally {
    if (started) {
      const stopped = await settleWithin(c.runtime.stop(), t.stopTimeoutMs);
      if (!stopped) c.logger.warn('runtime_stop_timeout', { ms: t.stopTimeoutMs });
    }
    c.logger.info('agent_stopped');
  }
}

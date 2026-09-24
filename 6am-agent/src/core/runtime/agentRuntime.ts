import type { AgentState, HeartbeatRequest, TrackingSettings } from '../contract/index.js';
import type { ScanSource } from '../contract/index.js';
import type { SettingsManager } from '../settings/settingsManager.js';
import type { StateStore } from '../state/stateStore.js';
import { ApiError, type ApiClient } from '../sync/apiClient.js';
import { nextDelayMs } from '../sync/backoff.js';
import { applyApiErrorState, blocksSync } from '../sync/errorPolicy.js';
import type { SyncManager, SyncOutcome } from '../sync/syncManager.js';
import type { AgentInfo } from '../sync/types.js';
import { systemClock, type Clock } from './clock.js';
import type { Logger } from './logger.js';

export interface RuntimeStatus {
  state: AgentState;
  running: boolean;
  syncing: boolean;
  lastHeartbeatAt: string | null;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  backoffAttempt: number;
  lastError: string | null;
}

export interface AgentRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  requestSync(): void;
  status(): RuntimeStatus;
}

export const TICK_MS = 60_000;
const MIN_TICK_MS = 1_000;
/** Used until settings were loaded once (contract §3.2 defaults). */
const DEFAULT_HEARTBEAT_SECONDS = 300;
const DEFAULT_SYNC_SECONDS = 120;
/** Contract §9.2: a disabled or uninstalled device keeps probing hourly. */
const DISABLED_HEARTBEAT_SECONDS = 3_600;
const MAX_LAST_ERROR_CHARS = 500;

/** Error name (and errno-style code) only: messages may quote file contents or paths. */
function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof ApiError) return { error: err.name, code: err.code, status: err.status };
  if (!(err instanceof Error)) return { error: typeof err };
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? { error: err.name, code } : { error: err.name };
}

/**
 * Semver precedence (semver.org §11): numeric major.minor.patch, then a pre-release sorts before
 * its release. Returns <0, 0 or >0. Build metadata is ignored.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const version = v.split('+')[0] ?? '';
    const dash = version.indexOf('-');
    const core = dash < 0 ? version : version.slice(0, dash);
    return {
      nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0),
      pre: dash < 0 ? null : version.slice(dash + 1),
    };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (x.pre === null || y.pre === null) return (x.pre === null ? 1 : 0) - (y.pre === null ? 1 : 0);
  const xs = x.pre.split('.');
  const ys = y.pre.split('.');
  for (let i = 0; i < Math.max(xs.length, ys.length); i += 1) {
    const p = xs[i];
    const q = ys[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      const diff = Number(p) - Number(q);
      if (diff !== 0) return diff;
    } else if (pn !== qn) {
      return pn ? -1 : 1;
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return 0;
}

/**
 * The agent's scheduler (PRD §33, contract §3.3, §9): a chained 60 s tick that refreshes settings,
 * sends heartbeats and starts syncs when due. At most one sync runs at a time; backoff is in
 * memory. `start()` never throws: every step catches, logs and continues.
 */
export function createAgentRuntime(d: {
  sync: SyncManager;
  api: ApiClient;
  state: StateStore;
  settings: SettingsManager;
  scan: ScanSource;
  agentInfo: () => Promise<AgentInfo>;
  clock?: Clock;
  logger: Logger;
}): AgentRuntime {
  const clock = d.clock ?? systemClock;
  let started = false;
  let stopped = false;
  let timer: unknown = null;
  let tickPromise: Promise<void> | null = null;
  let syncPromise: Promise<void> | null = null;
  let followUpRequested = false;
  let lastHeartbeatAt: Date | null = null;
  /** Null = due now (or, after a `stopped` outcome, as soon as the state stops blocking). */
  let nextSyncAt: Date | null = null;
  let attempt = 0;
  let inBackoff = false;

  const now = () => clock.now();

  const loadedSettings = (): TrackingSettings | null => {
    try {
      return d.settings.current();
    } catch {
      return null;
    }
  };

  const onRefreshError = (err: unknown): void => {
    if (err instanceof ApiError) applyApiErrorState(d.state, err, now());
    d.logger.warn('settings_refresh_failed', describeError(err));
  };

  const lastError = (): string | null => {
    const code = d.state.get('last_error_code');
    if (code === null) return null;
    const failedAt = d.state.get('last_failure_at');
    const succeededAt = d.state.get('last_success_sync_at');
    if (failedAt !== null && succeededAt !== null && succeededAt >= failedAt) return null;
    return code.slice(0, MAX_LAST_ERROR_CHARS);
  };

  const reportedState = (): AgentState => {
    if (syncPromise !== null) return 'syncing';
    if (inBackoff) return 'backoff';
    return d.state.get('agent_state') ?? 'ok';
  };

  /** needs_repair and device_disabled are local-only (contract §3.3); a probe reports ok. */
  const heartbeatState = (): AgentState => {
    const reported = reportedState();
    return reported === 'needs_repair' || reported === 'device_disabled' ? 'ok' : reported;
  };

  const heartbeatIntervalMs = (): number => {
    if (d.state.get('agent_state') === 'device_disabled') return DISABLED_HEARTBEAT_SECONDS * 1_000;
    return (loadedSettings()?.heartbeat_interval_seconds ?? DEFAULT_HEARTBEAT_SECONDS) * 1_000;
  };

  const heartbeatDueAt = (): number =>
    lastHeartbeatAt === null ? 0 : lastHeartbeatAt.getTime() + heartbeatIntervalMs();

  // ---------------------------------------------------------------------------------------------
  // Sync

  const applyOutcome = (outcome: SyncOutcome): void => {
    const at = now().getTime();
    switch (outcome.status) {
      case 'ok':
      case 'nothing': {
        attempt = 0;
        inBackoff = false;
        const seconds = loadedSettings()?.sync_interval_seconds ?? DEFAULT_SYNC_SECONDS;
        nextSyncAt = new Date(at + seconds * 1_000);
        break;
      }
      case 'failed': {
        const delay = outcome.error?.retryAfterMs ?? nextDelayMs(attempt);
        attempt += 1;
        inBackoff = true;
        nextSyncAt = new Date(at + delay);
        break;
      }
      case 'stopped':
        attempt = 0;
        inBackoff = false;
        nextSyncAt = null;
        break;
    }
  };

  const syncOnce = async (): Promise<void> => {
    if (blocksSync(d.state.get('agent_state'))) return;
    let outcome: SyncOutcome;
    try {
      outcome = await d.sync.runOnce();
    } catch (err) {
      d.logger.error('sync_run_failed', describeError(err));
      outcome = { status: 'failed', batches: 0, accepted: 0, rejected: 0 };
    }
    applyOutcome(outcome);
    d.logger.info('sync_finished', {
      status: outcome.status,
      batches: outcome.batches,
      accepted: outcome.accepted,
      rejected: outcome.rejected,
      ...(outcome.error === undefined ? {} : { code: outcome.error.code }),
    });
  };

  const syncLoop = async (): Promise<void> => {
    do {
      followUpRequested = false;
      try {
        await syncOnce();
      } catch (err) {
        d.logger.error('sync_run_failed', describeError(err));
      }
    } while (followUpRequested && !stopped);
  };

  /** Starts a sync now, or queues exactly one follow-up when one is already running. */
  const triggerSync = (): void => {
    if (stopped) return;
    if (syncPromise !== null) {
      followUpRequested = true;
      return;
    }
    syncPromise = syncLoop().finally(() => {
      syncPromise = null;
      schedule();
    });
  };

  // ---------------------------------------------------------------------------------------------
  // Heartbeat

  /**
   * Whether the backend now accepts this agent version. A heartbeat 200 alone is not proof: only
   * `GET /settings` answering 200 (its 426 check uses the same `X-Agent-Version`, contract §2) with
   * a `min_agent_version` this version meets. Any failure keeps `update_required`.
   */
  const versionAccepted = async (agentVersion: string): Promise<boolean> => {
    let fresh: TrackingSettings;
    try {
      fresh = await d.api.settings();
    } catch (err) {
      onRefreshError(err);
      return false;
    }
    const accepted = compareSemver(agentVersion, fresh.min_agent_version) >= 0;
    if (!accepted) {
      d.logger.warn('agent_update_required', { min_agent_version: fresh.min_agent_version });
    }
    return accepted;
  };

  const heartbeat = async (): Promise<void> => {
    lastHeartbeatAt = now();
    const settings = loadedSettings();
    const info = await d.agentInfo();
    const claudeCodeVersion = info.claude_code_version ?? (await d.scan.claudeCodeVersion());
    const lastActivity = await d.scan.lastLocalActivityAt();
    const req: HeartbeatRequest = {
      agent_version: info.agent_version,
      claude_code_version: claudeCodeVersion,
      platform_version: info.platform_version,
      hostname: settings?.categories.device === true ? info.hostname : null,
      agent_state: heartbeatState(),
      last_local_activity_at: lastActivity === null ? null : lastActivity.toISOString(),
      last_successful_sync_at: d.state.get('last_success_sync_at'),
      last_error: lastError(),
    };

    let resp;
    try {
      resp = await d.api.heartbeat(req);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      applyApiErrorState(d.state, err, now());
      d.logger.warn('heartbeat_failed', { code: err.code, status: err.status });
      return;
    }

    const stored = d.state.get('agent_state');
    if (
      stored === 'device_disabled' ||
      (stored === 'update_required' && (await versionAccepted(info.agent_version)))
    ) {
      d.state.set('agent_state', 'ok');
      d.logger.info('agent_state_cleared', { previous: stored });
    }
    const version = Math.max(resp.settings_version, d.api.lastSettingsVersion() ?? 0);
    if (settings === null || version > settings.version) {
      try {
        await d.settings.refreshIfNeeded(version);
      } catch (err) {
        onRefreshError(err);
      }
    }
    if (resp.sync_requested) triggerSync();
  };

  // ---------------------------------------------------------------------------------------------
  // Tick

  const step = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      d.logger.error('runtime_tick_failed', { step: name, ...describeError(err) });
    }
  };

  const tick = async (): Promise<void> => {
    await step('settings', async () => {
      if (blocksSync(d.state.get('agent_state'))) return;
      try {
        await d.settings.refreshIfNeeded();
      } catch (err) {
        onRefreshError(err);
      }
    });
    await step('heartbeat', async () => {
      if (d.state.get('agent_state') === 'needs_repair') return;
      if (now().getTime() >= heartbeatDueAt()) await heartbeat();
    });
    await step('sync', () => {
      if (syncPromise !== null || blocksSync(d.state.get('agent_state'))) return;
      if (nextSyncAt === null || now().getTime() >= nextSyncAt.getTime()) triggerSync();
    });
  };

  const runTick = async (): Promise<void> => {
    if (stopped || tickPromise !== null) return;
    tickPromise = tick().finally(() => {
      tickPromise = null;
      schedule();
    });
    await tickPromise;
  };

  /** (Re)arms the single chained timer: 60 s, or sooner when a heartbeat or sync is due. */
  function schedule(): void {
    if (stopped || !started) return;
    if (timer !== null) clock.clearTimeout(timer);
    let delay = TICK_MS;
    try {
      const at = now().getTime();
      if (d.state.get('agent_state') !== 'needs_repair') {
        delay = Math.min(delay, heartbeatDueAt() - at);
        if (
          syncPromise === null &&
          nextSyncAt !== null &&
          !blocksSync(d.state.get('agent_state'))
        ) {
          delay = Math.min(delay, nextSyncAt.getTime() - at);
        }
      }
    } catch (err) {
      d.logger.error('runtime_schedule_failed', describeError(err));
    }
    timer = clock.setTimeout(
      () => {
        timer = null;
        void runTick();
      },
      Math.max(MIN_TICK_MS, delay),
    );
  }

  return {
    async start() {
      if (started || stopped) return;
      started = true;
      await runTick();
    },

    async stop() {
      stopped = true;
      if (timer !== null) {
        clock.clearTimeout(timer);
        timer = null;
      }
      await Promise.allSettled([tickPromise, syncPromise]);
    },

    requestSync() {
      triggerSync();
    },

    status() {
      let state: AgentState = syncPromise !== null ? 'syncing' : 'ok';
      let lastSyncAt: string | null = null;
      let error: string | null = null;
      try {
        state = reportedState();
        lastSyncAt = d.state.get('last_success_sync_at');
        error = lastError();
      } catch (err) {
        d.logger.error('runtime_status_failed', describeError(err));
      }
      return {
        state,
        running: started && !stopped,
        syncing: syncPromise !== null,
        lastHeartbeatAt: lastHeartbeatAt === null ? null : lastHeartbeatAt.toISOString(),
        lastSyncAt,
        nextSyncAt: nextSyncAt === null ? null : nextSyncAt.toISOString(),
        backoffAttempt: attempt,
        lastError: error,
      };
    },
  };
}

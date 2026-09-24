import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { HeartbeatResponse, TrackingSettings } from '../../../src/core/contract/index.js';
import { createAgentRuntime } from '../../../src/core/runtime/agentRuntime.js';
import { systemClock } from '../../../src/core/runtime/clock.js';
import {
  createSettingsManager,
  type SettingsManager,
} from '../../../src/core/settings/settingsManager.js';
import { openStateStore, type StateStore } from '../../../src/core/state/stateStore.js';
import type { SyncOutcome } from '../../../src/core/sync/syncManager.js';
import type { AgentInfo } from '../../../src/core/sync/types.js';
import { makeAgentInfo } from '../../helpers/fakes/agentInfo.js';
import { FakeApiClient, apiError, networkError } from '../../helpers/fakes/apiClient.js';
import { createMemoryLogger } from '../../helpers/fakes/logger.js';
import { FakeScanSource } from '../../helpers/fakes/scanSource.js';
import { makeSettings } from '../../helpers/fakes/settings.js';

const START = new Date('2026-09-24T10:00:00.000Z');
const SEC = 1_000;
const MIN = 60 * SEC;

const outcome = (status: SyncOutcome['status'], o: Partial<SyncOutcome> = {}): SyncOutcome => ({
  status,
  batches: status === 'ok' ? 1 : 0,
  accepted: 0,
  rejected: 0,
  ...o,
});

const heartbeatResponse = (o: Partial<HeartbeatResponse> = {}): HeartbeatResponse => ({
  server_time: '2026-09-24T10:00:00Z',
  settings_version: 1,
  sync_requested: false,
  ...o,
});

function deferred<T>() {
  let resolve: (v: T) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('agentRuntime', () => {
  let state: StateStore;
  let api: FakeApiClient;
  let scan: FakeScanSource;
  let settings: SettingsManager;
  let logger: ReturnType<typeof createMemoryLogger>;
  let runOnce: Mock<() => Promise<SyncOutcome>>;
  let agentInfo: Mock<() => Promise<AgentInfo>>;
  let runtime: ReturnType<typeof createAgentRuntime>;

  const build = (o: { settings?: SettingsManager } = {}) =>
    createAgentRuntime({
      sync: { runOnce },
      api,
      state,
      settings: o.settings ?? settings,
      scan,
      agentInfo,
      clock: systemClock,
      logger,
    });

  const useServerSettings = (s: TrackingSettings) => {
    api.serverSettings = s;
  };

  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  beforeEach(() => {
    vi.useFakeTimers({ now: START });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    state = openStateStore(':memory:');
    api = new FakeApiClient();
    useServerSettings(
      makeSettings({ sync_interval_seconds: 3600, heartbeat_interval_seconds: 300 }),
    );
    scan = new FakeScanSource();
    logger = createMemoryLogger();
    settings = createSettingsManager({ api, state, logger });
    runOnce = vi.fn<() => Promise<SyncOutcome>>(() => Promise.resolve(outcome('ok')));
    agentInfo = vi.fn<() => Promise<AgentInfo>>(() => Promise.resolve(makeAgentInfo()));
    runtime = build();
  });

  afterEach(async () => {
    await runtime.stop();
    state.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('heartbeat', () => {
    it('heartbeat cadence follows heartbeat_interval_seconds', async () => {
      useServerSettings(
        makeSettings({ sync_interval_seconds: 3600, heartbeat_interval_seconds: 600 }),
      );
      await runtime.start();
      expect(api.count('heartbeat')).toBe(1);

      await advance(10 * MIN - SEC);
      expect(api.count('heartbeat')).toBe(1);
      await advance(SEC);
      expect(api.count('heartbeat')).toBe(2);
      await advance(10 * MIN);
      expect(api.count('heartbeat')).toBe(3);
    });

    it('sends versions, activity, last sync and state; hostname when the device category is ON', async () => {
      state.set('last_success_sync_at', '2026-09-24T09:00:00.000Z');
      await runtime.start();

      expect(api.heartbeatRequests[0]).toEqual({
        agent_version: '1.0.0',
        claude_code_version: '2.1.274',
        platform_version: '15.6.1',
        hostname: 'dev-laptop',
        agent_state: 'ok',
        last_local_activity_at: '2026-09-20T10:00:00.000Z',
        last_successful_sync_at: '2026-09-24T09:00:00.000Z',
        last_error: null,
      });
    });

    it('hostname is null when the device category is OFF', async () => {
      useServerSettings(makeSettings({ categories: { device: false } }));
      await runtime.start();
      expect(api.heartbeatRequests[0]?.hostname).toBeNull();
    });

    it('falls back to the scanner for claude_code_version and sends null activity when unknown', async () => {
      agentInfo.mockResolvedValue(makeAgentInfo({ claude_code_version: null }));
      scan.version = '2.2.0';
      scan.lastActivity = null;
      await runtime.start();
      expect(api.heartbeatRequests[0]).toMatchObject({
        claude_code_version: '2.2.0',
        last_local_activity_at: null,
      });
    });

    it('without loaded settings: 300 s cadence and hostname null', async () => {
      api.queue('settings', networkError(), networkError(), networkError());
      await runtime.start();
      expect(api.heartbeatRequests[0]?.hostname).toBeNull();
      await advance(5 * MIN - SEC);
      expect(api.count('heartbeat')).toBe(1);
      await advance(SEC);
      expect(api.count('heartbeat')).toBe(2);
    });

    it('reports the last error code only while it is newer than the last success, truncated to 500', async () => {
      state.set('last_error_code', 'x'.repeat(600));
      state.set('last_failure_at', '2026-09-24T09:30:00.000Z');
      state.set('last_success_sync_at', '2026-09-24T09:00:00.000Z');
      await runtime.start();
      expect(api.heartbeatRequests[0]?.last_error).toBe('x'.repeat(500));

      state.set('last_success_sync_at', '2026-09-24T09:45:00.000Z');
      await advance(5 * MIN);
      expect(api.heartbeatRequests[1]?.last_error).toBeNull();
    });

    it('a newer settings_version in the heartbeat response refetches settings', async () => {
      await runtime.start();
      useServerSettings(makeSettings({ version: 2, heartbeat_interval_seconds: 120 }));
      api.queue('heartbeat', heartbeatResponse({ settings_version: 2 }));

      await advance(5 * MIN);

      expect(settings.current().version).toBe(2);
      await advance(2 * MIN);
      expect(api.count('heartbeat')).toBe(3);
    });

    it('a newer X-Settings-Version header on the heartbeat refetches settings', async () => {
      await runtime.start();
      useServerSettings(makeSettings({ version: 3 }));
      api.settingsVersionHeader = 3;
      api.queue('heartbeat', heartbeatResponse({ settings_version: 1 }));
      await advance(5 * MIN);
      expect(settings.current().version).toBe(3);
    });

    it('a failing settings refetch after a heartbeat is recorded, not thrown', async () => {
      await runtime.start();
      api.queue('heartbeat', heartbeatResponse({ settings_version: 2 }));
      api.queue('settings', apiError('agent_outdated'));
      await advance(5 * MIN);
      expect(state.get('agent_state')).toBe('update_required');
    });

    it('401 on heartbeat ⇒ needs_repair ⇒ no more heartbeats or syncs', async () => {
      api.queue('heartbeat', apiError('unauthenticated'));
      await runtime.start();

      expect(state.get('agent_state')).toBe('needs_repair');
      expect(runOnce).not.toHaveBeenCalled();
      await advance(3 * 60 * MIN);
      expect(api.count('heartbeat')).toBe(1);
      expect(runOnce).not.toHaveBeenCalled();
      expect(runtime.status().state).toBe('needs_repair');
    });

    it('device_disabled ⇒ no syncs, heartbeat hourly, a 200 heartbeat clears it and syncing resumes', async () => {
      api.queue('heartbeat', apiError('device_disabled'));
      await runtime.start();
      expect(state.get('agent_state')).toBe('device_disabled');
      expect(runOnce).not.toHaveBeenCalled();
      const settingsCalls = api.count('settings');

      await advance(60 * MIN - SEC);
      expect(api.count('heartbeat')).toBe(1);
      expect(runOnce).not.toHaveBeenCalled();
      expect(api.count('settings')).toBe(settingsCalls);

      await advance(SEC);
      expect(api.count('heartbeat')).toBe(2);
      // device_disabled is local-only (contract §3.3): the probe reports ok.
      expect(api.heartbeatRequests[1]?.agent_state).toBe('ok');
      expect(state.get('agent_state')).toBe('ok');
      expect(runOnce).toHaveBeenCalledTimes(1);

      await advance(5 * MIN);
      expect(api.count('heartbeat')).toBe(3);
    });

    it('update_required is cleared by a 200 heartbeat', async () => {
      state.set('agent_state', 'update_required');
      await runtime.start();
      expect(state.get('agent_state')).toBe('ok');
      expect(runOnce).toHaveBeenCalledTimes(1);
    });

    it('sync_requested in a heartbeat triggers an immediate sync', async () => {
      await runtime.start();
      expect(runOnce).toHaveBeenCalledTimes(1);
      api.queue('heartbeat', heartbeatResponse({ sync_requested: true }));

      await advance(5 * MIN);

      expect(runOnce).toHaveBeenCalledTimes(2);
    });
  });

  describe('sync scheduling', () => {
    it('syncs immediately on start, then every sync_interval_seconds', async () => {
      useServerSettings(
        makeSettings({ sync_interval_seconds: 120, heartbeat_interval_seconds: 3600 }),
      );
      await runtime.start();
      await advance(0);
      expect(runOnce).toHaveBeenCalledTimes(1);
      expect(runtime.status().nextSyncAt).toBe(new Date(START.getTime() + 2 * MIN).toISOString());

      await advance(2 * MIN - SEC);
      expect(runOnce).toHaveBeenCalledTimes(1);
      await advance(SEC);
      expect(runOnce).toHaveBeenCalledTimes(2);
    });

    it('requestSync triggers a sync immediately, bypassing the interval', async () => {
      await runtime.start();
      await advance(0);
      runtime.requestSync();
      await advance(0);
      expect(runOnce).toHaveBeenCalledTimes(2);
    });

    it('no overlapping syncs: requests during a sync queue exactly one follow-up', async () => {
      let active = 0;
      let maxActive = 0;
      const gates: ReturnType<typeof deferred<SyncOutcome>>[] = [];
      runOnce.mockImplementation(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const gate = deferred<SyncOutcome>();
        gates.push(gate);
        try {
          return await gate.promise;
        } finally {
          active -= 1;
        }
      });

      await runtime.start();
      expect(runOnce).toHaveBeenCalledTimes(1);
      expect(runtime.status()).toMatchObject({ syncing: true, state: 'syncing' });

      runtime.requestSync();
      runtime.requestSync();
      await advance(5 * MIN);
      expect(runOnce).toHaveBeenCalledTimes(1);
      expect(api.heartbeatRequests[1]?.agent_state).toBe('syncing');

      gates[0]?.resolve(outcome('ok'));
      await advance(0);
      expect(runOnce).toHaveBeenCalledTimes(2);

      gates[1]?.resolve(outcome('ok'));
      await advance(0);
      expect(runOnce).toHaveBeenCalledTimes(2);
      expect(maxActive).toBe(1);
      expect(runtime.status().syncing).toBe(false);
    });

    it('backoff after failure uses nextDelayMs, attempt increments, and resets on success', async () => {
      runOnce.mockResolvedValue(outcome('failed'));
      await runtime.start();
      expect(runtime.status()).toMatchObject({ state: 'backoff', backoffAttempt: 1 });
      expect(runtime.status().nextSyncAt).toBe(new Date(START.getTime() + 30 * SEC).toISOString());

      await advance(30 * SEC - 1);
      expect(runOnce).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(runOnce).toHaveBeenCalledTimes(2);
      expect(runtime.status().backoffAttempt).toBe(2);

      await advance(60 * SEC);
      expect(runOnce).toHaveBeenCalledTimes(3);

      runOnce.mockResolvedValue(outcome('nothing'));
      await advance(120 * SEC);
      expect(runOnce).toHaveBeenCalledTimes(4);
      expect(runtime.status()).toMatchObject({ backoffAttempt: 0, state: 'ok' });
    });

    it('heartbeat reports backoff while in backoff', async () => {
      runOnce.mockResolvedValue(outcome('failed'));
      useServerSettings(
        makeSettings({ sync_interval_seconds: 3600, heartbeat_interval_seconds: 60 }),
      );
      await runtime.start();
      await advance(MIN);
      expect(api.heartbeatRequests[1]?.agent_state).toBe('backoff');
    });

    it('Retry-After on the failure overrides the exponential delay', async () => {
      runOnce.mockResolvedValue(outcome('failed', { error: apiError('rate_limited', 5_000) }));
      await runtime.start();
      expect(runtime.status().nextSyncAt).toBe(new Date(START.getTime() + 5 * SEC).toISOString());
      await advance(5 * SEC);
      expect(runOnce).toHaveBeenCalledTimes(2);
    });

    it('requestSync bypasses the backoff', async () => {
      runOnce.mockResolvedValue(outcome('failed'));
      await runtime.start();
      runtime.requestSync();
      await advance(0);
      expect(runOnce).toHaveBeenCalledTimes(2);
    });

    it('stopped outcome ⇒ no sync scheduling until the state clears', async () => {
      runOnce.mockImplementation(() => {
        state.set('agent_state', 'update_required');
        return Promise.resolve(outcome('stopped', { error: apiError('agent_outdated') }));
      });
      await runtime.start();
      expect(runtime.status()).toMatchObject({
        nextSyncAt: null,
        backoffAttempt: 0,
        state: 'update_required',
      });
      api.heartbeatHandler = () => {
        throw apiError('agent_outdated');
      };

      await advance(2 * 60 * MIN);
      expect(runOnce).toHaveBeenCalledTimes(1);

      api.heartbeatHandler = () => heartbeatResponse();
      await advance(5 * MIN);
      expect(runOnce).toHaveBeenCalledTimes(2);
    });

    it('requestSync is ignored while the state blocks syncing', async () => {
      state.set('agent_state', 'needs_repair');
      runtime.requestSync();
      await advance(0);
      expect(runOnce).not.toHaveBeenCalled();
    });
  });

  describe('resilience', () => {
    it('survives runOnce throwing (treated as failed with backoff) and keeps ticking', async () => {
      runOnce.mockRejectedValueOnce(new Error('sqlite exploded'));
      await runtime.start();
      expect(runtime.status().backoffAttempt).toBe(1);
      expect(logger.entries.some((e) => e.level === 'error')).toBe(true);

      await advance(30 * SEC);
      expect(runOnce).toHaveBeenCalledTimes(2);
      expect(runtime.status().backoffAttempt).toBe(0);
    });

    it('survives heartbeat and scan errors and keeps ticking', async () => {
      api.queue('heartbeat', new Error('socket hang up'));
      await runtime.start();
      expect(logger.entries.some((e) => e.msg === 'runtime_tick_failed')).toBe(true);

      scan.lastLocalActivityAt = () => Promise.reject(new Error('EACCES'));
      await advance(5 * MIN);
      expect(api.count('heartbeat')).toBe(1);

      scan.lastLocalActivityAt = () => Promise.resolve(null);
      await advance(5 * MIN);
      expect(api.count('heartbeat')).toBe(2);
    });

    it('a heartbeat network error is recorded and ticking continues', async () => {
      api.queue('heartbeat', networkError());
      await runtime.start();
      expect(state.get('last_error_code')).toBe('network');
      await advance(5 * MIN);
      expect(api.count('heartbeat')).toBe(2);
    });

    it('settings refresh errors in a tick are recorded or logged, never thrown', async () => {
      const broken: SettingsManager = {
        current: () => {
          throw new Error('tracking settings not loaded');
        },
        refreshIfNeeded: () => Promise.reject(new Error('boom')),
      };
      runtime = build({ settings: broken });
      await expect(runtime.start()).resolves.toBeUndefined();
      expect(logger.entries.some((e) => e.msg === 'settings_refresh_failed')).toBe(true);
      expect(api.count('heartbeat')).toBe(1);

      await runtime.stop();
      api.queue('settings', apiError('unauthenticated'));
      runtime = build();
      await runtime.start();
      expect(state.get('agent_state')).toBe('needs_repair');
      expect(api.count('heartbeat')).toBe(1);
    });

    it('keeps ticking when the state store throws during a tick', async () => {
      await runtime.start();
      const spy = vi.spyOn(state, 'get').mockImplementation(() => {
        throw new Error('database is closed');
      });
      await advance(MIN);
      spy.mockRestore();
      await advance(5 * MIN);
      expect(api.count('heartbeat')).toBeGreaterThanOrEqual(2);
    });
  });

  describe('lifecycle', () => {
    it('start twice is a no-op', async () => {
      await runtime.start();
      await runtime.start();
      expect(api.count('heartbeat')).toBe(1);
      expect(runOnce).toHaveBeenCalledTimes(1);
    });

    it('stop() stops ticks and awaits the in-flight sync', async () => {
      const gate = deferred<SyncOutcome>();
      runOnce.mockReturnValueOnce(gate.promise);
      await runtime.start();

      let stopped = false;
      const stopping = runtime.stop().then(() => {
        stopped = true;
      });
      await advance(0);
      expect(stopped).toBe(false);

      gate.resolve(outcome('ok'));
      await stopping;
      expect(stopped).toBe(true);
      expect(runtime.status().running).toBe(false);

      await advance(3 * 60 * MIN);
      expect(api.count('heartbeat')).toBe(1);
      expect(runOnce).toHaveBeenCalledTimes(1);
      runtime.requestSync();
      await advance(0);
      expect(runOnce).toHaveBeenCalledTimes(1);
    });

    it('stop() before start is safe and start after stop does nothing', async () => {
      await runtime.stop();
      await runtime.start();
      expect(api.count('heartbeat')).toBe(0);
    });

    it('status() is a snapshot of state, timers and the last error', async () => {
      expect(runtime.status()).toEqual({
        state: 'ok',
        running: false,
        syncing: false,
        lastHeartbeatAt: null,
        lastSyncAt: null,
        nextSyncAt: null,
        backoffAttempt: 0,
        lastError: null,
      });

      runOnce.mockImplementation(() => {
        state.commitBatch([], { last_success_sync_at: new Date().toISOString() });
        return Promise.resolve(outcome('ok'));
      });
      await runtime.start();
      await advance(0);

      expect(runtime.status()).toEqual({
        state: 'ok',
        running: true,
        syncing: false,
        lastHeartbeatAt: START.toISOString(),
        lastSyncAt: START.toISOString(),
        nextSyncAt: new Date(START.getTime() + 60 * MIN).toISOString(),
        backoffAttempt: 0,
        lastError: null,
      });

      state.set('last_error_code', 'persistence_failed');
      state.set('last_failure_at', new Date(START.getTime() + SEC).toISOString());
      expect(runtime.status().lastError).toBe('persistence_failed');
    });
  });
});
